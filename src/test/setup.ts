import "@testing-library/jest-dom/vitest";

class ResizeObserverMock {
  observe() {}

  unobserve() {}

  disconnect() {}
}

if (!window.ResizeObserver) {
  window.ResizeObserver = ResizeObserverMock;
}

if (!window.DOMRect.fromRect) {
  window.DOMRect.fromRect = function fromRect(rect = {}) {
    const {
      x = 0,
      y = 0,
      width = 0,
      height = 0,
    } = rect as Partial<DOMRectInit>;

    return new window.DOMRect(x, y, width, height);
  };
}

if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

if (!document.elementFromPoint) {
  document.elementFromPoint = () => document.body;
}

if (!window.HTMLElement.prototype.getClientRects) {
  window.HTMLElement.prototype.getClientRects = function getClientRects() {
    return {
      item: () => null,
      length: 0,
      [Symbol.iterator]: function* iterator() {},
    } as DOMRectList;
  };
}

if (!window.Range.prototype.getClientRects) {
  window.Range.prototype.getClientRects = function getClientRects() {
    return {
      item: () => null,
      length: 0,
      [Symbol.iterator]: function* iterator() {},
    } as DOMRectList;
  };
}

if (!window.Range.prototype.getBoundingClientRect) {
  window.Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return new window.DOMRect(0, 0, 0, 0);
  };
}

const textPrototype = window.Text.prototype as typeof window.Text.prototype & {
  getBoundingClientRect?: () => DOMRect;
  getClientRects?: () => DOMRectList;
};

if (!textPrototype.getClientRects) {
  textPrototype.getClientRects = function getClientRects() {
    return {
      item: () => null,
      length: 0,
      [Symbol.iterator]: function* iterator() {},
    } as DOMRectList;
  };
}

if (!textPrototype.getBoundingClientRect) {
  textPrototype.getBoundingClientRect = function getBoundingClientRect() {
    return new window.DOMRect(0, 0, 0, 0);
  };
}

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    }) as MediaQueryList;
}
