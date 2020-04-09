import { toggleMark } from 'prosemirror-commands';

import {
  CommandMarkTypeParameter,
  convertCommand,
  ManagerMarkTypeParameter,
  isElementDOMNode,
  isString,
  KeyBindings,
  MarkExtension,
  MarkExtensionSpec,
  MarkGroup,
  markInputRule,
} from '@remirror/core';

export class BoldExtension extends MarkExtension {
  get name() {
    return 'bold' as const;
  }

  get schema(): MarkExtensionSpec {
    return {
      group: MarkGroup.FontStyle,
      parseDOM: [
        {
          tag: 'strong',
        },
        // This works around a Google Docs misbehavior where
        // pasted content will be inexplicably wrapped in `<b>`
        // tags with a font-weight normal.
        {
          tag: 'b',
          getAttrs: (node) =>
            isElementDOMNode(node) && node.style.fontWeight !== 'normal' ? null : false,
        },
        {
          style: 'font-weight',
          getAttrs: (node) =>
            isString(node) && /^(bold(er)?|[5-9]\d{2,})$/.test(node) ? null : false,
        },
      ],
      toDOM: () => ['strong', 0],
    };
  }

  public keys({ type }: ManagerMarkTypeParameter): KeyBindings {
    return {
      'Mod-b': convertCommand(toggleMark(type)),
    };
  }

  public commands({ type }: CommandMarkTypeParameter) {
    return {
      bold: () => {
        return toggleMark(type);
      },
    };
  }

  public inputRules({ type }: ManagerMarkTypeParameter) {
    return [markInputRule({ regexp: /(?:\*\*|__)([^*_]+)(?:\*\*|__)$/, type })];
  }
}
