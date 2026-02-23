import { describe, expect, it } from "bun:test";
import { ReplayBuffer } from "./replay-buffer.ts";

describe("ReplayBuffer", () => {
  it("stores data up to capacity", () => {
    const buf = new ReplayBuffer(16);
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    buf.append(data);

    const contents = buf.getContents();
    expect(contents).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it("overwrites oldest data when full (ring behavior)", () => {
    const buf = new ReplayBuffer(8);
    buf.append(new Uint8Array([1, 2, 3, 4, 5, 6]));
    buf.append(new Uint8Array([7, 8, 9, 10]));

    const contents = buf.getContents();
    expect(contents).toEqual(new Uint8Array([3, 4, 5, 6, 7, 8, 9, 10]));
  });

  it("returns all buffered data in correct order after wrap-around", () => {
    const buf = new ReplayBuffer(8);
    buf.append(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    buf.append(new Uint8Array([9, 10, 11]));

    const contents = buf.getContents();
    expect(contents).toEqual(new Uint8Array([4, 5, 6, 7, 8, 9, 10, 11]));
  });

  it("handles zero-length writes", () => {
    const buf = new ReplayBuffer(16);
    buf.append(new Uint8Array([1, 2, 3]));
    buf.append(new Uint8Array([]));

    const contents = buf.getContents();
    expect(contents).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("handles exactly-at-capacity writes", () => {
    const buf = new ReplayBuffer(4);
    buf.append(new Uint8Array([1, 2, 3, 4]));

    const contents = buf.getContents();
    expect(contents).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("handles write larger than capacity", () => {
    const buf = new ReplayBuffer(4);
    buf.append(new Uint8Array([1, 2, 3, 4, 5, 6]));

    const contents = buf.getContents();
    expect(contents).toEqual(new Uint8Array([3, 4, 5, 6]));
  });

  it("returns empty Uint8Array when nothing has been written", () => {
    const buf = new ReplayBuffer(16);
    const contents = buf.getContents();
    expect(contents).toEqual(new Uint8Array([]));
  });

  it("returns empty Uint8Array after clear", () => {
    const buf = new ReplayBuffer(16);
    buf.append(new Uint8Array([1, 2, 3]));
    buf.clear();

    const contents = buf.getContents();
    expect(contents).toEqual(new Uint8Array([]));
  });

  it("can accept new data after clear", () => {
    const buf = new ReplayBuffer(8);
    buf.append(new Uint8Array([1, 2, 3]));
    buf.clear();
    buf.append(new Uint8Array([4, 5]));

    const contents = buf.getContents();
    expect(contents).toEqual(new Uint8Array([4, 5]));
  });

  it("defaults to 1 MB capacity", () => {
    const buf = new ReplayBuffer();
    const chunk = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) {
      buf.append(chunk);
    }
    const contents = buf.getContents();
    expect(contents.length).toBe(1024 * 1024);
  });

  it("handles multiple small appends that together exceed capacity", () => {
    const buf = new ReplayBuffer(8);
    for (let i = 1; i <= 12; i++) {
      buf.append(new Uint8Array([i]));
    }

    const contents = buf.getContents();
    expect(contents).toEqual(new Uint8Array([5, 6, 7, 8, 9, 10, 11, 12]));
  });
});
