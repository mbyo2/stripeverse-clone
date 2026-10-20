interface LogoProps {
  /** color = orange + navy mark, navy wordmark. white/black/navy = one-colour versions. */
  variant?: "color" | "white" | "black" | "navy";
  /** Render the "BMaGlass Pay" wordmark next to the mark. */
  withWordmark?: boolean;
  /** Tailwind sizing for the mark, e.g. "h-8 w-8". */
  markClassName?: string;
  className?: string;
}

const MARK_COLORS = {
  color: { upper: "#F7931A", lower: "#003087" },
  white: { upper: "#FFFFFF", lower: "#FFFFFF" },
  black: { upper: "#000000", lower: "#000000" },
  navy: { upper: "#003087", lower: "#003087" },
} as const;

const WORDMARK_COLORS = {
  color: "text-[#003087]",
  white: "text-white",
  black: "text-black",
  navy: "text-[#003087]",
} as const;

/**
 * BMaGlass Pay logo. The mark is a geometric "B" built from two stacked
 * bowls sharing one stem and one arc radius (r=11 on a 64 grid): the Bitcoin
 * orange upper bowl overlaps the navy lower bowl. Flat only — no gradients,
 * no shadows — so it survives in one colour, black, and white at 16px.
 */
const Logo = ({
  variant = "color",
  withWordmark = true,
  markClassName = "h-8 w-8",
  className = "",
}: LogoProps) => {
  const { upper, lower } = MARK_COLORS[variant];

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        viewBox="0 0 64 64"
        role="img"
        aria-label="BMaGlass Pay"
        className={`${markClassName} shrink-0`}
      >
        <path d="M17 30 H36 A11 11 0 0 1 36 52 H17 Z" fill={lower} />
        <path d="M17 12 H34 A11 11 0 0 1 34 34 H17 Z" fill={upper} />
      </svg>
      {withWordmark && (
        <span
          className={`font-display text-[19px] font-bold leading-none tracking-[-0.02em] ${WORDMARK_COLORS[variant]}`}
        >
          BMaGlass&nbsp;Pay
        </span>
      )}
    </span>
  );
};

export default Logo;
