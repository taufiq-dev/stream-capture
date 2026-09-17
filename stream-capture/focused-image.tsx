// focused-image.tsx
//
// Shows only the guide-box region of a captured image. The uploaded image carries extra context
// around the card for the backend (see CropSpec.margin); the viewer should see what they framed.
// The frame takes the region's aspect ratio and clips; the <img> is scaled up by 1/focus and
// shifted so the region fills the frame — no second encode, no canvas.

import React from "react";
import styled from "styled-components";
import type { FocusRegion } from "./capture-photo";

type FocusedImageProps = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  "src" | "width" | "height" | "style"
> & {
  src: string;
  /** Region to display, as fractions of the image — `CaptureResult.focus`. */
  focus: FocusRegion;
  /** Encoded image size — `CaptureResult.width` / `height`. Sizes the frame before the image loads. */
  imageWidth: number;
  imageHeight: number;
  /** Applied to the clipping frame, so callers can size it like any block. */
  className?: string;
};

const Frame = styled.div`
  position: relative;
  overflow: hidden;
  width: 100%;
`;

const Img = styled.img`
  position: absolute;
  display: block;
  max-width: none; /* global img { max-width: 100% } resets would defeat the scale-up */
`;

const FocusedImage: React.FC<FocusedImageProps> = ({
  src,
  focus,
  imageWidth,
  imageHeight,
  className,
  alt = "",
  ...rest
}) => {
  const regionWidth = focus.width * imageWidth;
  const regionHeight = focus.height * imageHeight;
  return (
    <Frame className={className} style={{ aspectRatio: `${regionWidth} / ${regionHeight}` }}>
      <Img
        src={src}
        alt={alt}
        style={{
          width: `${100 / focus.width}%`,
          height: `${100 / focus.height}%`,
          left: `${(-focus.x / focus.width) * 100}%`,
          top: `${(-focus.y / focus.height) * 100}%`,
        }}
        {...rest}
      />
    </Frame>
  );
};

export default FocusedImage;
