import { expect, test } from "bun:test";
import { RealtimeConnection } from "../src/realtime/connection";
import { fakeSockets } from "./fake-socket";

test("callbacks queued before stop cannot reopen the connection or deliver events", () => {
  const { factory, last } = fakeSockets();
  const connection = new RealtimeConnection({ url: "ws://x", createSocket: factory, pingMs: 0 });
  const errors: string[] = [];
  connection.onError((code) => errors.push(code));
  connection.start();
  const opened = last().onopen;
  const message = last().onmessage;
  connection.stop();
  opened?.({});
  message?.({ data: JSON.stringify({ type: "error", code: "stale" }) });
  expect(connection.status).toBe("closed");
  expect(errors).toEqual([]);
});

test("a replaced socket cannot close the new connection or deliver its old events", () => {
  const { factory, last } = fakeSockets();
  const connection = new RealtimeConnection({ url: "ws://x", createSocket: factory, pingMs: 0 });
  const errors: string[] = [];
  connection.onError((code) => errors.push(code));
  connection.start();
  last().open();
  const closed = last().onclose;
  const message = last().onmessage;
  connection.stop();
  connection.start();
  last().open();
  try {
    message?.({ data: JSON.stringify({ type: "error", code: "stale" }) });
    closed?.({ code: 1006 });
    expect(connection.status).toBe("open");
    expect(connection.isOpen).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    connection.stop();
  }
});

test("a status listener can stop an opening connection without leaving a heartbeat", () => {
  const { factory, last } = fakeSockets();
  let intervals = 0;
  const connection = new RealtimeConnection({
    url: "ws://x",
    createSocket: factory,
    timers: {
      setTimeout: () => 1,
      clearTimeout: () => {},
      setInterval: () => ++intervals,
      clearInterval: () => --intervals,
    },
  });
  connection.onStatus((status) => {
    if (status === "open") connection.stop();
  });
  connection.start();
  last().open();
  expect(connection.status).toBe("closed");
  expect(intervals).toBe(0);
});
