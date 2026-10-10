package session

import (
	"context"
	"slices"
	"sync"

	"github.com/shuymn/kastty/internal/protocol"
)

// maxCoalescedBytes caps one WebSocket message made of consecutive output
// frames. PTY reads are small (about 1 KiB on macOS), so a view that fell a few
// MiB behind would otherwise catch up one tiny message at a time.
const maxCoalescedBytes = 1 << 20

type frame struct {
	binary bool
	data   []byte
	// droppable frames (live output, size and title updates) may be discarded
	// while a view lags, because the resync snapshot supersedes them. The rest
	// (handshake, snapshots, editor replies, errors, exit) are always sent.
	droppable bool
}

// View is one attached connection. A goroutine per view writes its queue, so a
// slow connection never blocks the PTY or other views.
type View struct {
	s      *Session
	conn   Conn
	ctx    context.Context
	cancel context.CancelFunc
	wake   chan struct{}

	// lastSize is the size the view can display, and active when it last typed
	// or reported a size; both guarded by s.mu.
	lastSize *protocol.Size
	active   uint64

	mu          sync.Mutex // guards the fields below; taken after s.mu, never before
	queue       []frame
	queuedBytes int // droppable bytes waiting in queue
	lagging     bool
	closing     bool
	stopped     bool
}

func newView(s *Session, conn Conn) *View {
	ctx, cancel := context.WithCancel(context.Background())
	return &View{s: s, conn: conn, ctx: ctx, cancel: cancel, wake: make(chan struct{}, 1)}
}

func (v *View) notify() {
	select {
	case v.wake <- struct{}{}:
	default:
	}
}

func (v *View) enqueue(f frame) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.stopped || v.closing {
		return
	}
	if f.droppable {
		if v.lagging {
			return
		}
		if v.queuedBytes+len(f.data) > v.s.highWater {
			// Too far behind: stop streaming and resync once the queue drains.
			v.lagging = true
			v.queue = slices.DeleteFunc(v.queue, func(q frame) bool { return q.droppable })
			v.queuedBytes = 0
			v.notify()
			return
		}
		v.queuedBytes += len(f.data)
	}
	v.queue = append(v.queue, f)
	v.notify()
}

// resume ends lagging with the resync frames; called with s.mu held.
func (v *View) resume(frames ...frame) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.stopped || v.closing {
		return
	}
	v.lagging = false
	v.queue = append(v.queue, frames...)
	v.notify()
}

// isLagging reports whether the view is waiting for a resync; called with s.mu held.
func (v *View) isLagging() bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.lagging
}

func (v *View) closeAfterFlush() {
	v.mu.Lock()
	v.closing = true
	v.mu.Unlock()
	v.notify()
}

// stop ends the writer without flushing; the connection is gone.
func (v *View) stop() {
	v.mu.Lock()
	v.stopped = true
	v.queue = nil
	v.mu.Unlock()
	v.cancel()
}

// fail closes a view whose connection broke; the server then detaches it.
func (v *View) fail() {
	v.stop()
	_ = v.conn.Close()
}

func (v *View) run() {
	for {
		v.mu.Lock()
		for len(v.queue) == 0 {
			switch {
			case v.stopped:
				v.mu.Unlock()
				return
			case v.closing:
				v.stopped = true
				v.mu.Unlock()
				_ = v.conn.Close()
				return
			case v.lagging:
				v.mu.Unlock()
				if !v.s.resync(v) {
					// Exited or detached: the exit frames or stop arrive next.
					select {
					case <-v.wake:
					case <-v.ctx.Done():
					}
				}
				v.mu.Lock()
				continue
			}
			v.mu.Unlock()
			select {
			case <-v.wake:
			case <-v.ctx.Done():
			}
			v.mu.Lock()
		}
		batch := v.queue
		v.queue = nil
		v.queuedBytes = 0
		v.mu.Unlock()

		for len(batch) > 0 {
			var f frame
			f, batch = coalesce(batch)
			if err := v.conn.Write(v.ctx, f.binary, f.data); err != nil {
				v.fail()
				return
			}
		}
	}
}

// coalesce joins the binary frames at the head of batch, which are a byte
// stream to the view, into one frame, and returns it with the rest of batch.
func coalesce(batch []frame) (frame, []frame) {
	f := batch[0]
	n := 1
	if f.binary {
		size := len(f.data)
		for n < len(batch) && batch[n].binary && size+len(batch[n].data) <= maxCoalescedBytes {
			size += len(batch[n].data)
			n++
		}
		if n > 1 {
			// A fresh buffer: frame data is shared with the other views.
			data := make([]byte, 0, size)
			for _, g := range batch[:n] {
				data = append(data, g.data...)
			}
			f = frame{binary: true, data: data}
		}
	}
	return f, batch[n:]
}
