// app.styles.ts
import styled, { createGlobalStyle, css } from "styled-components";
import FocusedImage from "@stream-capture/focused-image";

export const GlobalStyle = createGlobalStyle`
  *, *::before, *::after { box-sizing: border-box; }

  body {
    margin: 0;
    background: ${({ theme }) => theme.foundation.color.background};
    color: ${({ theme }) => theme.foundation.color.text};
    font-family: ${({ theme }) => theme.foundation.font.family};
    font-size: 15px;
    line-height: 1.45;
    -webkit-text-size-adjust: 100%;
  }
`;

export const Page = styled.main`
  max-width: 640px;
  margin: 0 auto;
  padding: ${({ theme }) => `${theme.foundation.space[24]} ${theme.foundation.space[16]} ${theme.foundation.space[32]}`};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.foundation.space[16]};
`;

export const Title = styled.h1`
  margin: 0;
  font-size: 22px;
  letter-spacing: -0.01em;
`;

export const Lead = styled.p`
  margin: ${({ theme }) => theme.foundation.space[4]} 0 0;
  color: ${({ theme }) => theme.foundation.color.textMuted};
`;

export const Card = styled.section`
  background: ${({ theme }) => theme.foundation.color.surface};
  border: 1px solid ${({ theme }) => theme.foundation.color.border};
  border-radius: ${({ theme }) => theme.foundation.radius.medium};
  padding: ${({ theme }) => theme.foundation.space[16]};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.foundation.space[12]};
`;

export const CardTitle = styled.h2`
  margin: 0;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: ${({ theme }) => theme.foundation.space[8]};
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.foundation.color.textMuted};
`;

// How many rows the pane holds, so the total is readable without scrolling it.
export const Count = styled.span`
  font-weight: 500;
  font-size: 12px;
  text-transform: none;
  letter-spacing: 0;
  font-variant-numeric: tabular-nums;
`;

export const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${({ theme }) => theme.foundation.space[12]};
`;

export const Field = styled.label`
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.foundation.space[8]};

  select {
    font: inherit;
    padding: ${({ theme }) => `${theme.foundation.space[4]} ${theme.foundation.space[8]}`};
    border: 1px solid ${({ theme }) => theme.foundation.color.border};
    border-radius: ${({ theme }) => theme.foundation.radius.small};
    background: ${({ theme }) => theme.foundation.color.surface};
  }
`;

export const Button = styled.button<{ $variant?: "primary" | "secondary" }>`
  font: inherit;
  font-weight: 600;
  min-height: 44px;
  padding: 0 ${({ theme }) => theme.foundation.space[16]};
  border-radius: ${({ theme }) => theme.foundation.radius.pill};
  cursor: pointer;
  border: 1px solid
    ${({ theme, $variant = "primary" }) =>
      $variant === "primary" ? theme.foundation.color.primary : theme.foundation.color.border};
  background: ${({ theme, $variant = "primary" }) =>
    $variant === "primary" ? theme.foundation.color.primary : theme.foundation.color.surface};
  color: ${({ theme, $variant = "primary" }) =>
    $variant === "primary" ? theme.foundation.color.onPrimary : theme.foundation.color.text};

  &:active {
    opacity: 0.8;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const Mono = styled.code`
  font-family: ${({ theme }) => theme.foundation.font.mono};
  font-size: 12.5px;
  word-break: break-all;
`;

export const Muted = styled.span`
  color: ${({ theme }) => theme.foundation.color.textMuted};
`;

export const SessionList = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.foundation.space[8]};
`;

export const SessionItem = styled.li`
  border: 1px solid ${({ theme }) => theme.foundation.color.border};
  border-radius: ${({ theme }) => theme.foundation.radius.small};
  padding: ${({ theme }) => theme.foundation.space[12]};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.foundation.space[4]};
`;

export const Badge = styled.span<{ $tone: "positive" | "warning" | "neutral" }>`
  display: inline-block;
  padding: 1px ${({ theme }) => theme.foundation.space[8]};
  border-radius: ${({ theme }) => theme.foundation.radius.pill};
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.foundation.color.onPrimary};
  background: ${({ theme, $tone }) =>
    $tone === "positive"
      ? theme.foundation.color.positive
      : $tone === "warning"
        ? theme.foundation.color.warning
        : theme.foundation.color.textMuted};
`;

export const CandidateTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;

  th,
  td {
    text-align: left;
    padding: ${({ theme }) => `${theme.foundation.space[4]} ${theme.foundation.space[8]} ${theme.foundation.space[4]} 0`};
    border-top: 1px solid ${({ theme }) => theme.foundation.color.border};
    vertical-align: top;
  }

  th {
    border-top: none;
    color: ${({ theme }) => theme.foundation.color.textMuted};
    font-weight: 600;
    position: sticky;
    top: 0;
    z-index: 1;
    background: ${({ theme }) => theme.foundation.color.surface};
    /* border-collapse: collapse drops a sticky cell's own border, so draw it inset */
    box-shadow: inset 0 -1px 0 ${({ theme }) => theme.foundation.color.border};
  }
`;

// Without $maxHeight this is the old horizontal-only scroller (wide tables on a phone).
// With it, the pane also scrolls vertically and stops adding to the page's height.
export const Scroll = styled.div<{ $maxHeight?: string }>`
  overflow-x: auto;

  ${({ $maxHeight }) =>
    $maxHeight &&
    css`
      max-height: ${$maxHeight};
      overflow-y: auto;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
    `}
`;

export const Figure = styled.figure`
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.foundation.space[4]};

  figcaption {
    font-size: 13px;
    color: ${({ theme }) => theme.foundation.color.textMuted};
  }
`;

// Framed with the theme's component-layer tokens, the way a host app's upload area would be.
export const UploadedImage = styled.img`
  display: block;
  width: 100%;
  background: ${({ theme }) => theme.component.uploadArea.background};
  border: ${({ theme }) =>
    `${theme.component.uploadArea.borderWidth} ${theme.component.uploadArea.borderStyle} ${theme.component.uploadArea.borderColor}`};
  border-radius: ${({ theme }) => theme.component.uploadArea.borderRadius};
`;

export const Focused = styled(FocusedImage)`
  border-radius: ${({ theme }) => theme.component.uploadArea.borderRadius};
`;
