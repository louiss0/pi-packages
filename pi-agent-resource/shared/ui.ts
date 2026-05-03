export const formOverlayOffsetY = -250;

export const formOverlayOptions = {
  overlay: true,
  overlayOptions: {
    offsetY: formOverlayOffsetY,
  },
} as const;

export const modalEditorOverlayOptions = {
  overlay: true,
  overlayOptions: {
    anchor: "center",
    width: "80%",
    maxHeight: "80%",
  },
} as const;
