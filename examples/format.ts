/**
 * Terminal-formatting helpers for the example runner.
 *
 * Styling is delegated to established libraries rather than hand-rolled ANSI:
 *   - `chalk`          — colors and text modifiers
 *   - `boxen`          — the title banner box
 *   - `json-colorizer` — JSON syntax highlighting (uses `colorette` internally)
 *
 * chalk and colorette both honor `NO_COLOR` / non-TTY output, so piping the
 * runner's output yields clean, uncolored text.
 */
import boxen from 'boxen';
import chalk from 'chalk';
import { colorize, color } from 'json-colorizer';

/** A bordered title box, e.g. `LI.FI Composer · swap`. */
export const banner = (title: string): string =>
  boxen(chalk.bold.cyan(title), {
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    borderStyle: 'round',
    borderColor: 'blue',
  });

/** A labelled key/value line, e.g. `  backend  https://…`. */
export const field = (label: string, value: string): string =>
  `  ${chalk.gray(label.padEnd(8))} ${value}`;

/** A section header, e.g. `▸ Request`. */
export const section = (title: string): string => chalk.bold.blue(`▸ ${title}`);

/** A pill/badge, e.g. a staged-preview marker. */
export const badge = (text: string): string =>
  chalk.bgYellow.black.bold(` ${text} `);

export const info = (text: string): string => `${chalk.blue('ℹ')} ${text}`;
export const warn = (text: string): string =>
  `${chalk.yellow('⚠')} ${chalk.yellow(text)}`;
export const success = (text: string): string =>
  chalk.green(`✔ ${text}`);
export const failure = (text: string): string =>
  `${chalk.red('✖')} ${chalk.bold.red(text)}`;

/**
 * Render a value as syntax-highlighted JSON, indented two spaces so it nests
 * visually under its section header.
 */
export const jsonBlock = (value: unknown): string => {
  const highlighted = colorize(value as Parameters<typeof colorize>[0], {
    indent: 2,
    colors: {
      StringKey: color.cyan,
      StringLiteral: color.green,
      NumberLiteral: color.yellow,
      BooleanLiteral: color.magenta,
      NullLiteral: color.magenta,
      Brace: color.gray,
      Bracket: color.gray,
      Colon: color.gray,
      Comma: color.gray,
      Whitespace: (text) => `${text}`,
    },
  });
  return highlighted
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
};

/** Format a caught error: bold red headline + dimmed stack/detail. */
export const formatError = (err: unknown): string => {
  if (err instanceof Error) {
    const head = failure(`${err.name}: ${err.message}`);
    const stack = err.stack?.split('\n').slice(1).join('\n');
    return stack ? `${head}\n${chalk.gray(stack)}` : head;
  }
  return failure(String(err));
};
