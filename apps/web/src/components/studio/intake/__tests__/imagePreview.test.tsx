import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuildIntake } from "../BuildIntake";
import { makeFile, stubObjectUrls } from "./helpers";

afterEach(cleanup);

function setup() {
  const urls = stubObjectUrls();
  const onUpload = vi.fn(async (file: File) => ({
    asset_id: "asset-1",
    mime_type: file.type,
    size_bytes: file.size,
    preview_url: "/api/assets/images/asset-1",
  }));
  const onGenerate = vi.fn(async () => undefined);
  const utils = render(<BuildIntake onUpload={onUpload} onGenerate={onGenerate} />);
  const input = screen.getByTestId("image-dropzone-input");
  const select = (file: File) => fireEvent.change(input, { target: { files: [file] } });
  return { ...urls, onUpload, onGenerate, select, ...utils };
}

describe("image preview lifecycle", () => {
  it("previews locally without uploading on selection", () => {
    const { create, onUpload, select } = setup();
    select(makeFile("rover.png", "image/png"));
    const img = screen.getByRole("img", { name: "Preview of rover.png" }) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("blob:preview-1");
    expect(create).toHaveBeenCalledTimes(1);
    expect(onUpload).not.toHaveBeenCalled();
    expect(screen.getByText(/not uploaded yet/)).toBeTruthy();
  });

  it("revokes the old URL when the image is replaced", () => {
    const { revoke, select } = setup();
    select(makeFile("a.png", "image/png"));
    select(makeFile("b.jpg", "image/jpeg"));
    expect(revoke).toHaveBeenCalledWith("blob:preview-1");
    expect(screen.getByRole("img", { name: "Preview of b.jpg" }).getAttribute("src")).toBe("blob:preview-2");
  });

  it("revokes on remove and on unmount", async () => {
    const user = userEvent.setup();
    const { revoke, select, unmount } = setup();
    select(makeFile("a.png", "image/png"));
    await user.click(screen.getByRole("button", { name: "Remove image" }));
    expect(revoke).toHaveBeenCalledWith("blob:preview-1");
    expect(screen.queryByRole("img")).toBeNull();
    select(makeFile("b.png", "image/png"));
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:preview-2");
  });

  it("uploads only on explicit Generate and sends the asset id", async () => {
    const user = userEvent.setup();
    const { onUpload, onGenerate, select } = setup();
    const file = makeFile("rover.png", "image/png");
    select(file);
    await user.click(screen.getByRole("button", { name: "Upload and generate" }));
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload.mock.calls[0][0]).toBe(file);
    expect(onGenerate).toHaveBeenCalledWith({
      input: { kind: "image", image_asset_id: "asset-1", user_text: null },
      requirements: { max_budget: null, currency: "USD" },
    });
  });

  it("sends prompt and budget, and rejects an invalid budget", async () => {
    const user = userEvent.setup();
    const { onGenerate, onUpload } = setup();
    await user.type(screen.getByLabelText(/what should it do/i), "Avoid obstacles");
    await user.type(screen.getByLabelText(/max budget/i), "-5");
    await user.click(screen.getByRole("button", { name: "Generate" }));
    expect(screen.getByTestId("intake-error").textContent).toMatch(/positive number/);
    expect(onGenerate).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText(/max budget/i));
    await user.type(screen.getByLabelText(/max budget/i), "80");
    await user.click(screen.getByRole("button", { name: "Generate" }));
    expect(onUpload).not.toHaveBeenCalled();
    expect(onGenerate).toHaveBeenCalledWith({
      input: { kind: "text", image_asset_id: null, user_text: "Avoid obstacles" },
      requirements: { max_budget: 80, currency: "USD" },
    });
  });
});
