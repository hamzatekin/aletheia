import { describe, expect, it } from 'vitest';
import { blockToHtml } from './markdown';
import { toggleTask } from './task-list';

const box = (line: number, checked = false) => `<label><input type="checkbox"${checked ? ' checked=""' : ''} tabindex="-1" data-line="${line}"></label>`;

describe('task lists', () => {
  it('render as checkboxes in the editor\'s markup, each with its source line', () => {
    expect(blockToHtml('- [ ] a\n- [x] **b**\n  - [X] c')).toBe(
      '<ul data-type="taskList" data-tight="true">\n' +
        `<li data-type="taskItem" data-checked="false">${box(0)}<div><p>a</p>\n</div></li>\n` +
        `<li data-type="taskItem" data-checked="true">${box(1, true)}<div><p><strong>b</strong></p>\n` +
        '<ul data-type="taskList" data-tight="true">\n' +
        `<li data-type="taskItem" data-checked="true">${box(2, true)}<div><p>c</p>\n</div></li>\n` +
        '</ul>\n</div></li>\n</ul>\n',
    );
  });

  it('keep a loose list loose and count an empty item', () => {
    expect(blockToHtml('- [ ] a\n\n- [ ]')).toBe(
      '<ul data-type="taskList">\n' +
        `<li data-type="taskItem" data-checked="false">${box(0)}<div><p>a</p>\n</div></li>\n` +
        `<li data-type="taskItem" data-checked="false">${box(2)}<div><p></p>\n</div></li>\n</ul>\n`,
    );
  });

  it('work inside quotes', () => {
    expect(blockToHtml('> - [ ] q')).toContain(`<li data-type="taskItem" data-checked="false">${box(0)}<div><p>q</p>`);
  });

  it('need a bulleted list of nothing but tasks', () => {
    expect(blockToHtml('[ ] not in a list')).toBe('<p>[ ] not in a list</p>\n');
    expect(blockToHtml('1. [ ] numbered')).toBe('<ol>\n<li>[ ] numbered</li>\n</ol>\n');
    expect(blockToHtml('- [ ] a\n- plain')).toBe('<ul>\n<li>[ ] a</li>\n<li>plain</li>\n</ul>\n');
    expect(blockToHtml('- [ ]x')).toBe('<ul>\n<li>[ ]x</li>\n</ul>\n');
    expect(blockToHtml('- [y] a')).toBe('<ul>\n<li>[y] a</li>\n</ul>\n');
  });
});

describe('toggleTask', () => {
  it('ticks and clears the item on the given line only', () => {
    const note = 'Steps\n\n- [ ] a\n  * [x] b\n> + [ ] c';
    expect(toggleTask(note, 2, true)).toBe('Steps\n\n- [x] a\n  * [x] b\n> + [ ] c');
    expect(toggleTask(note, 3, false)).toBe('Steps\n\n- [ ] a\n  * [ ] b\n> + [ ] c');
    expect(toggleTask(note, 4, true)).toBe('Steps\n\n- [ ] a\n  * [x] b\n> + [x] c');
  });

  it('leaves a line without a checkbox alone', () => {
    expect(toggleTask('Steps\n- a [ ] b', 0, true)).toBe('Steps\n- a [ ] b');
    expect(toggleTask('Steps\n- a [ ] b', 1, true)).toBe('Steps\n- a [ ] b');
    expect(toggleTask('- [ ] a', 5, true)).toBe('- [ ] a');
  });
});
