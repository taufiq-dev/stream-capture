// capture-button.tsx
import React from "react";
import styled from "styled-components";

type CaptureButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children">;

// Same geometry as the previous canvas drawing — a 70px ring with a 5px stroke and a 54px filled
// disc inside it — but as a real <button>: sharp on 3x screens, focusable, and disable-able.
const Ring = styled.button`
  position: relative;
  width: 70px;
  height: 70px;
  padding: 0;
  border: 5px solid #fff;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  &::after {
    content: "";
    position: absolute;
    top: 3px;
    right: 3px;
    bottom: 3px;
    left: 3px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.1s ease-out;
  }

  &:active::after {
    transform: scale(0.9);
  }

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }

  &:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 4px;
  }
`;

const CaptureButton: React.FC<CaptureButtonProps> = ({ "aria-label": ariaLabel = "Take photo", ...rest }) => (
  <Ring type="button" aria-label={ariaLabel} {...rest} />
);

export default CaptureButton;
