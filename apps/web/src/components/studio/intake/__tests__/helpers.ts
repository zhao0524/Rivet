import { vi } from "vitest";
import type { JobEvent } from "../types";

export function makeFile(name: string, type: string, size = 1024): File {
  const file = new File([new Uint8Array(Math.min(size, 16))], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

export function stubObjectUrls() {
  let counter = 0;
  const create = vi.fn((_blob: Blob) => `blob:preview-${++counter}`);
  const revoke = vi.fn((_url: string) => undefined);
  Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: create });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: revoke });
  return { create, revoke };
}

export function event(partial: Partial<JobEvent> & Pick<JobEvent, "event_id" | "stage">): JobEvent {
  return {
    job_id: "job-1",
    actor: "system",
    status: "running",
    message: `${partial.stage} event ${partial.event_id}`,
    timestamp: `2026-10-24T00:00:${String(partial.event_id).padStart(2, "0")}Z`,
    references: [],
    ...partial,
  };
}
