import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { useMounted } from "./use-mounted";

function MountStatus() {
  return createElement("span", null, useMounted() ? "mounted" : "not-mounted");
}

describe("useMounted", () => {
  it("uses the unmounted snapshot during server rendering", () => {
    expect(renderToString(createElement(MountStatus))).toBe(
      "<span>not-mounted</span>",
    );
  });
});
