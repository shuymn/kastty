const DEFAULT_CAPACITY = 1024 * 1024; // 1 MB

export class ReplayBuffer {
  private buf: Uint8Array;
  private capacity: number;
  private head = 0;
  private size = 0;

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.capacity = capacity;
    this.buf = new Uint8Array(capacity);
  }

  append(data: Uint8Array): void {
    const len = data.length;
    if (len === 0) return;

    if (len >= this.capacity) {
      this.buf.set(data.subarray(len - this.capacity));
      this.head = 0;
      this.size = this.capacity;
      return;
    }

    const writeStart = (this.head + this.size) % this.capacity;
    const spaceToEnd = this.capacity - writeStart;

    if (len <= spaceToEnd) {
      this.buf.set(data, writeStart);
    } else {
      this.buf.set(data.subarray(0, spaceToEnd), writeStart);
      this.buf.set(data.subarray(spaceToEnd), 0);
    }

    const newSize = this.size + len;
    if (newSize > this.capacity) {
      const overflow = newSize - this.capacity;
      this.head = (this.head + overflow) % this.capacity;
      this.size = this.capacity;
    } else {
      this.size = newSize;
    }
  }

  getContents(): Uint8Array {
    if (this.size === 0) return new Uint8Array(0);

    const result = new Uint8Array(this.size);
    const tailLen = Math.min(this.size, this.capacity - this.head);
    result.set(this.buf.subarray(this.head, this.head + tailLen));
    if (tailLen < this.size) {
      result.set(this.buf.subarray(0, this.size - tailLen), tailLen);
    }
    return result;
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
  }
}
