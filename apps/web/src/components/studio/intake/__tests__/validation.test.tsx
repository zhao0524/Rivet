import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageDropzone } from "../ImageDropzone";
import { MAX_IMAGE_BYTES, validateImageFile } from "../validation";
import { makeFile, stubObjectUrls } from "./helpers";

afterEach(cleanup);

describe("validateImageFile", () => {
  it.each(["image/png", "image/jpeg", "image/webp"])("accepts %s", (type) => {
    expect(validateImageFile(makeFile("rover", type))).toEqual({ ok: true });
  });

  it("accepts a file exactly at the size limit", () => {
    expect(validateImageFile(makeFile("a.png", "image/png", MAX_IMAGE_BYTES)).ok).toBe(true);
  });

  it("rejects unsupported types with a clear message", () => {
    const result = validateImageFile(makeFile("anim.gif", "image/gif"));
    expect(result).toMatchObject({ ok: false, code: "UNSUPPORTED_TYPE" });
    if (!result.ok) expect(result.message).toContain("PNG, JPEG or WebP");
  });

  it("does not trust the extension alone", () => {
    expect(validateImageFile(makeFile("fake.png", "application/pdf")).ok).toBe(false);
    expect(validateImageFile(makeFile("noext", "")).ok).toBe(false);
  });

  it("rejects oversized and empty files", () => {
    const big = validateImageFile(makeFile("big.jpg", "image/jpeg", MAX_IMAGE_BYTES + 1));
    expect(big).toMatchObject({ ok: false, code: "FILE_TOO_LARGE" });
    if (!big.ok) expect(big.message).toContain("10.0 MB");
    expect(validateImageFile(makeFile("empty.png", "image/png", 0))).toMatchObject({ ok: false, code: "EMPTY_FILE" });
  });

  it("honours a custom limit", () => {
    expect(validateImageFile(makeFile("a.png", "image/png", 2048), { maxBytes: 1024 }).ok).toBe(false);
  });
});

describe("ImageDropzone validation", () => {
  it("shows an alert and does not accept an invalid dropped file", () => {
    stubObjectUrls();
    const onFileAccepted = vi.fn();
    const onRejected = vi.fn();
    render(<ImageDropzone file={null} onFileAccepted={onFileAccepted} onRejected={onRejected} />);
    const zone = screen.getByRole("group", { name: /reference image/i });
    fireEvent.drop(zone, { dataTransfer: { files: [makeFile("big.png", "image/png", MAX_IMAGE_BYTES * 2)] } });
    expect(onFileAccepted).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ code: "FILE_TOO_LARGE" }), expect.any(File));
    expect(screen.getByRole("alert").textContent).toMatch(/limit is 10\.0 MB/);
  });

  it("accepts a valid file from the picker and clears a previous error", () => {
    stubObjectUrls();
    const onFileAccepted = vi.fn();
    render(<ImageDropzone file={null} onFileAccepted={onFileAccepted} />);
    const input = screen.getByTestId("image-dropzone-input");
    fireEvent.change(input, { target: { files: [makeFile("doc.gif", "image/gif")] } });
    expect(screen.getByRole("alert")).toBeTruthy();
    const good = makeFile("rover.webp", "image/webp");
    fireEvent.change(input, { target: { files: [good] } });
    expect(onFileAccepted).toHaveBeenCalledWith(good);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores drops while disabled", () => {
    const onFileAccepted = vi.fn();
    render(<ImageDropzone file={null} onFileAccepted={onFileAccepted} disabled />);
    fireEvent.drop(screen.getByRole("group"), { dataTransfer: { files: [makeFile("r.png", "image/png")] } });
    expect(onFileAccepted).not.toHaveBeenCalled();
  });
});
