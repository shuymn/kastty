// Package pty runs a command in a pseudo-terminal and moves raw bytes in and out.
package pty

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/creack/pty"
)

// drainTimeout bounds how long Wait keeps reading after the command exits.
// Background jobs can hold the terminal open forever; the session ends when
// the command it started exits, as before.
const drainTimeout = 200 * time.Millisecond

// PTY is a running command attached to a pseudo-terminal.
type PTY struct {
	cmd    *exec.Cmd
	master *os.File

	exited   chan struct{}
	exitCode int

	closeOnce sync.Once
}

// Start runs argv in a new session with the PTY as its controlling terminal.
// env is the complete environment; TERM is set to xterm-256color.
func Start(argv []string, env []string, cols, rows int) (*PTY, error) {
	if len(argv) == 0 {
		return nil, errors.New("pty: empty command")
	}
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Env = append(append([]string(nil), env...), "TERM=xterm-256color")
	master, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	if err != nil {
		return nil, fmt.Errorf("start %s: %w", argv[0], err)
	}
	if master, err = pollable(master); err != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return nil, fmt.Errorf("start %s: %w", argv[0], err)
	}
	p := &PTY{cmd: cmd, master: master, exited: make(chan struct{})}
	go p.wait()
	return p, nil
}

// pollable reopens creack/pty's blocking master as a non-blocking file in the
// runtime poller, so Close interrupts a pending Read. Otherwise a background
// job that keeps the terminal open would block reading, and so the end of the
// session, after the command exits.
func pollable(f *os.File) (*os.File, error) {
	defer f.Close()
	syscall.ForkLock.RLock()
	fd, err := syscall.Dup(int(f.Fd()))
	if err == nil {
		syscall.CloseOnExec(fd)
	}
	syscall.ForkLock.RUnlock()
	if err != nil {
		return nil, err
	}
	if err := syscall.SetNonblock(fd, true); err != nil {
		_ = syscall.Close(fd)
		return nil, err
	}
	return os.NewFile(uintptr(fd), f.Name()), nil
}

func (p *PTY) wait() {
	_ = p.cmd.Wait()
	p.exitCode = exitCode(p.cmd.ProcessState)
	close(p.exited)
}

// exitCode follows the shell convention: 128 + signal number for a signal. It
// is 1 when the command could not be waited for.
func exitCode(state *os.ProcessState) int {
	if state == nil {
		return 1
	}
	if ws, ok := state.Sys().(syscall.WaitStatus); ok && ws.Signaled() {
		return 128 + int(ws.Signal())
	}
	return state.ExitCode()
}

// Read reads output from the command. After the command exits it keeps
// returning buffered output for a short time, then returns an error.
func (p *PTY) Read(b []byte) (int, error) {
	return p.master.Read(b)
}

// Write sends input to the command.
func (p *PTY) Write(b []byte) (int, error) {
	return p.master.Write(b)
}

// Resize changes the terminal size; the command receives SIGWINCH.
func (p *PTY) Resize(cols, rows int) error {
	// Not pty.Setsize: its Fd() call would make the master blocking again, and
	// races with Close. Control fails cleanly once the master is closed.
	conn, err := p.master.SyscallConn()
	if err != nil {
		return err
	}
	ws := pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)}
	var errno syscall.Errno
	if err := conn.Control(func(fd uintptr) {
		_, _, errno = syscall.Syscall(syscall.SYS_IOCTL, fd, syscall.TIOCSWINSZ, uintptr(unsafe.Pointer(&ws)))
	}); err != nil {
		return err
	}
	if errno != 0 {
		return errno
	}
	return nil
}

// ExitCode returns the command's exit code; valid after Exited is closed.
func (p *PTY) ExitCode() int {
	<-p.exited
	return p.exitCode
}

// CloseAfterDrain closes the PTY once the command has exited and reading has
// had drainTimeout to pick up its last output. Pending reads then fail.
func (p *PTY) CloseAfterDrain(readDone <-chan struct{}) {
	<-p.exited
	select {
	case <-readDone:
	case <-time.After(drainTimeout):
	}
	p.close()
}

// Kill hangs up the terminal (SIGHUP to the command's process group, as a
// closing terminal would) and force-kills it if it is still running after a
// grace period.
func (p *PTY) Kill() {
	pid := p.cmd.Process.Pid
	_ = syscall.Kill(-pid, syscall.SIGHUP)
	select {
	case <-p.exited:
	case <-time.After(2 * time.Second):
		_ = syscall.Kill(-pid, syscall.SIGKILL)
		<-p.exited
	}
	p.close()
}

func (p *PTY) close() {
	p.closeOnce.Do(func() { _ = p.master.Close() })
}
