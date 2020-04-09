import { lift, setBlockType, wrapIn } from 'prosemirror-commands';
import { liftListItem, wrapInList } from 'prosemirror-schema-list';

import { isFunction, isNumber, object } from '@remirror/core-helpers';
import {
  AnyFunction,
  AttributesParameter,
  EditorSchema,
  MarkType,
  MarkTypeParameter,
  NodeType,
  NodeTypeParameter,
  ProsemirrorAttributes,
  ProsemirrorCommandFunction,
  ProsemirrorNode,
  RangeParameter,
  TransformTransactionParameter,
} from '@remirror/core-types';

import { getMarkRange, isMarkType, isNodeType } from './dom-utils';
import { findParentNode, isNodeActive, selectionEmpty } from './prosemirror-utils';

interface UpdateMarkParameter
  extends Partial<RangeParameter>,
    Partial<AttributesParameter>,
    TransformTransactionParameter {
  /**
   * The text to append.
   *
   * @defaultValue '''
   */
  appendText?: string;

  /**
   * The type of the
   */
  type: MarkType;
}
/**
 * Update the selection with the provided MarkType
 *
 * @param type - the type to update the mark to
 * @param attrs - attrs to use for the mark
 *
 * @public
 */
export const updateMark = ({
  type,
  attrs: attributes = object<ProsemirrorAttributes>(),
  appendText,
  range,
}: UpdateMarkParameter): ProsemirrorCommandFunction => (state, dispatch) => {
  const { selection } = state;
  const { tr } = state;
  const { from, to } = range ?? selection;

  tr.addMark(from, to, type.create(attributes));

  if (appendText) {
    tr.insertText(appendText);
  }

  if (dispatch) {
    dispatch(tr);
  }

  return true;
};

/**
 * Toggle between wrapping an inactive node with the provided node type, and lifting it up into it's parent.
 *
 * @param type - the node type to toggle
 * @param attrs - the attrs to use for the node
 *
 * @public
 */
export const toggleWrap = (
  type: NodeType,
  attributes: ProsemirrorAttributes,
): ProsemirrorCommandFunction => (state, dispatch) => {
  const isActive = isNodeActive({ state, type });

  if (isActive) {
    return lift(state, dispatch);
  }

  return wrapIn(type, attributes)(state, dispatch);
};

function isList(node: ProsemirrorNode, schema: EditorSchema) {
  return node.type === schema.nodes.bulletList || node.type === schema.nodes.orderedList;
}

/**
 * Toggles a list item.
 *
 * @remarks
 * When the provided list wrapper is inactive (e.g. ul) then wrap the list with this type.
 * When it is active then remove the selected line from the list.
 *
 * @param type - the list node type
 * @param itemType - the list item type (must be in the schema)
 *
 * @public
 */
export const toggleList = (type: NodeType, itemType: NodeType): ProsemirrorCommandFunction => (
  state,
  dispatch,
) => {
  const { schema, selection } = state;
  const { $from, $to } = selection;
  const range = $from.blockRange($to);

  if (!range) {
    return false;
  }

  const parentList = findParentNode({
    predicate: (node) => isList(node, schema),
    selection,
  });

  if (range.depth >= 1 && parentList && range.depth - parentList.depth <= 1) {
    if (parentList.node.type === type) {
      return liftListItem(itemType)(state, dispatch);
    }

    if (isList(parentList.node, schema) && type.validContent(parentList.node.content)) {
      const { tr } = state;
      tr.setNodeMarkup(parentList.pos, type);

      if (dispatch) {
        dispatch(tr);
      }

      return true;
    }
  }

  return wrapInList(type)(state, dispatch);
};

interface ToggleBlockItemParameter extends NodeTypeParameter, Partial<AttributesParameter> {
  /**
   * The type to toggle back to. Usually this is the paragraph node type.
   */
  toggleType: NodeType;
}

/**
 * Toggle a block between the provided type and toggleType.
 *
 * @param params - the destructured params
 *
 * @public
 */
export const toggleBlockItem = ({
  type,
  toggleType,
  attrs: attributes = object<ProsemirrorAttributes>(),
}: ToggleBlockItemParameter): ProsemirrorCommandFunction => (state, dispatch) => {
  const isActive = isNodeActive({ state, type, attrs: attributes });

  if (isActive) {
    return setBlockType(toggleType)(state, dispatch);
  }

  return setBlockType(type, attributes)(state, dispatch);
};

interface ReplaceTextParameter
  extends Partial<RangeParameter>,
    Partial<AttributesParameter>,
    TransformTransactionParameter {
  /**
   * The text to append.
   *
   * @defaultValue '''
   */
  appendText?: string;
  /**
   * Optional text content to include.
   */
  content?: string;

  /**
   * The content type to be inserted in place of the range / selection.
   */
  type?: NodeType | MarkType;
}

interface CallMethodParameter<
  GFunction extends AnyFunction,
  GReturn extends ReturnType<GFunction>
> {
  fn: GFunction | unknown;
  defaultReturn: GReturn;
}

/**
 * A utility for calling option functions that may not exist
 */
const callMethod = <
  GFunction extends AnyFunction,
  GReturn extends ReturnType<GFunction>,
  GParameter extends Parameters<GFunction>
>(
  { fn, defaultReturn }: CallMethodParameter<GFunction, GReturn>,
  arguments_: GParameter,
): GReturn => (isFunction(fn) ? fn(...arguments_) : defaultReturn);

/**
 * Taken from https://stackoverflow.com/a/4900484
 *
 * Check that the browser is chrome. Supports passing a minimum version to check that it is a greater than or equal version.
 */
const isChrome = (minVersion = 0): boolean => {
  const parsedAgent = navigator.userAgent.match(/Chrom(e|ium)\/(\d+)\./);

  return parsedAgent ? Number.parseInt(parsedAgent[2], 10) >= minVersion : false;
};

/**
 * Replaces text with an optional appended string at the end
 *
 * @param params - the destructured params
 *
 * @public
 */
export const replaceText = ({
  range,
  type,
  attrs: attributes = object<ProsemirrorAttributes>(),
  appendText = '',
  content = '',
  startTransaction,
  endTransaction,
}: ReplaceTextParameter): ProsemirrorCommandFunction => (state, dispatch) => {
  const { schema, selection } = state;
  // const { $from, $to } = selection;
  const index = selection.$from.index();
  const { from, to } = range ?? selection;

  // Run the pre transaction hook
  const tr = callMethod({ fn: startTransaction, defaultReturn: state.tr }, [state.tr, state]);
  if (isNodeType(type)) {
    if (!selection.$from.parent.canReplaceWith(index, index, type)) {
      return false;
    }

    tr.replaceWith(from, to, type.create(attributes, content ? schema.text(content) : undefined));
  } else {
    if (!content) {
      throw new Error('`replaceText` cannot be called without content when using a mark type');
    }

    tr.replaceWith(
      from,
      to,
      schema.text(content, isMarkType(type) ? [type.create(attributes)] : undefined),
    );
  }

  /** Only append the text if when text is provided. */
  if (appendText) {
    tr.insertText(appendText);
  }

  if (dispatch) {
    if (isChrome(60)) {
      // A workaround for a chrome bug
      // https://github.com/ProseMirror/prosemirror/issues/710#issuecomment-338047650
      document.getSelection()?.empty();
    }
    dispatch(callMethod({ fn: endTransaction, defaultReturn: tr }, [tr, state]));
  }

  return true;
};

interface RemoveMarkParameter
  extends MarkTypeParameter,
    Partial<RangeParameter<'to'>>,
    TransformTransactionParameter {
  /**
   * Whether to expand empty selections to the current mark range
   *
   * @defaultValue `false`
   */
  expand?: boolean;
}

/**
 * Removes a mark from the current selection or provided from to
 *
 * @param params - the destructured params
 *
 * @public
 */
export const removeMark = ({
  type,
  expand = false,
  range,
  endTransaction,
  startTransaction,
}: RemoveMarkParameter): ProsemirrorCommandFunction => (state, dispatch) => {
  const { selection } = state;
  const tr = callMethod({ fn: startTransaction, defaultReturn: state.tr }, [state.tr, state]);
  let { from, to } = range ?? selection;

  if (expand) {
    ({ from, to } = range
      ? getMarkRange(state.doc.resolve(range.from), type) ||
        (isNumber(range.to) && getMarkRange(state.doc.resolve(range.to), type)) || { from, to }
      : selectionEmpty(state)
      ? getMarkRange(state.selection.$anchor, type) || { from, to }
      : { from, to });
  }

  tr.removeMark(from, isNumber(to) ? to : from, type);

  if (dispatch) {
    dispatch(callMethod({ fn: endTransaction, defaultReturn: tr }, [tr, state]));
  }

  return true;
};

/**
 * An empty (noop) command function.
 *
 * @remarks
 *
 * This is typically to represent the default _do nothing_ action.
 */
export const emptyCommandFunction: ProsemirrorCommandFunction = () => false;
