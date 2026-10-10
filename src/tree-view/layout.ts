/** Row geometry and touch timing shared by rows, bullets and drag and drop. */

/** How far each level is indented. */
export const INDENT_PX = 24;
/** Phones indent less, like WorkFlowy's app, so deep outlines keep room for text. */
export const TOUCH_INDENT_PX = 18;

/** How long a finger stays down before a long press fires (selects a row, or opens a bullet's menu). */
export const LONG_PRESS_MS = 450;
/** A finger that moves further than this is scrolling, not pressing. */
export const LONG_PRESS_SLOP_PX = 10;
