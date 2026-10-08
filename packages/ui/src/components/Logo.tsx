export type LogoProps = { size?: number; desc?: boolean; white?: boolean };

/** C.logo: wordmark "TAKE IT" + three skewed bars + "EASY", optional tagline. */
export function Logo({ size = 20, desc = false, white = false }: LogoProps) {
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: same markup as the prototype's C.logo.
    <div class={`logo${white ? ' w' : ''}`} style={{ fontSize: `${size}px` }} aria-label="Take It Easy">
      <div class="wm">
        <span>TAKE IT</span>
        <span class="el" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>EASY</span>
      </div>
      {desc ? (
        <div class="desc" style={{ fontSize: '.3em' }}>
          INGLÊS PARA QUEM FALA PORTUGUÊS
        </div>
      ) : null}
    </div>
  );
}
