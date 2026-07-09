import { Platform } from "react-native";

/**
 * Cross-platform style fragment that removes the **browser default focus
 * outline** from a React Native `<TextInput>` when it renders on the web.
 *
 * ## Why
 *
 * On the web, React Native Web renders `<TextInput>` as a plain HTML
 * `<input>` element. Browsers apply a user-agent stylesheet that draws a
 * distinct focus ring (typically a black or dark-blue rectangle) INSIDE any
 * custom border the app has already drawn. In our design system every input
 * already has a colored border / background to indicate focus, so the extra
 * outline reads as a broken layout.
 *
 * Spreading this constant into a TextInput's style array strips the outline
 * on web without touching iOS or Android (both of which ignore the CSS
 * properties). The constant is `undefined` on native so the merged style
 * array stays clean.
 *
 * ## Usage
 *
 * ```tsx
 * import { WEB_INPUT_RESET } from "@workspace/shared-ui/utils";
 *
 * <TextInput style={[styles.input, WEB_INPUT_RESET]} />
 * ```
 *
 * Or as a StyleSheet key when composing:
 *
 * ```tsx
 * const styles = StyleSheet.create({
 *   input: { fontSize: 14, ...WEB_INPUT_RESET },
 * });
 * ```
 *
 * Both patterns work: it's a plain style object, not a component.
 *
 * ## Accessibility note
 *
 * Removing the focus outline reduces visible keyboard-focus affordance. Every
 * consumer of this helper is responsible for showing its OWN focus state
 * (usually via a colored wrap border or background change). All input wraps
 * in this app already do that, which is why removing the browser default is
 * safe here.
 */
/**
 * The reset is typed as `Record<string, unknown> | undefined` so consumers can
 * spread it into any RN style object (`TextStyle`, `ViewStyle`, `StyleProp`)
 * without triggering TS2769. The runtime values are only meaningful to React
 * Native Web (which forwards them to the DOM); on native the whole object is
 * `undefined` and the spread is a no-op.
 */
export const WEB_INPUT_RESET: Record<string, string | number> | undefined = Platform.select({
  web: {
    // Standard CSS outline properties — supported by React Native Web.
    outlineWidth: 0,
    outlineStyle: "none",
    outlineColor: "transparent",
    // Some browsers (notably Safari) add a subtle focus box-shadow on inputs
    // in addition to the outline. Reset it too.
    boxShadow: "none",
  },
  default: undefined,
});

/**
 * Convenience alias — some call sites read better with an "s" (a "reset" of
 * outline styles). Both names point to the same object so tree-shaking is a
 * no-op.
 */
export const webInputReset = WEB_INPUT_RESET;
