import { targetLayerId, workingTarget, type ActiveRow } from "./active-row";
import {
  canDuplicateLayer,
  canRemoveGroup,
  canRemoveLayer,
  whyNotMergeDown,
  type Layer,
  type LayerGroup,
  type MergeDownBlock,
} from "./document";

export type PanelButton = { enabled: boolean; title: string };

export interface LayerPanelActions {
  /** Layer the header would act on, or null when the working row is not a layer. */
  layerId: number | null;
  /** Group the header's Delete would act on, or null when the working row is not a group. Delete is
   *  the ONLY header action a group answers: Duplicate/Merge/New group are layer-scoped. */
  groupId: number | null;
  duplicate: PanelButton;
  merge: PanelButton;
  group: PanelButton;
  remove: PanelButton;
}

const MERGE_REASON: Record<MergeDownBlock, string> = {
  "no-layer-below": "no layer below to merge into",
  "not-drawing": "only drawing layers can be merged",
  "read-only": "a layer is locked or hidden",
  animated: "a layer is animated — Stop animating first",
  loop: "a loop repeats over frames that change on the other layer — end the loop first",
};

const SELECT_LAYER = "select a layer first";

/** Enablement + titles for the layer-panel header actions. One place so Duplicate/Merge/Group/
 *  Delete cannot each re-derive a leftover `activeLayerId` while audio or a group is selected. */
export function layerPanelActions(args: {
  activeRow: ActiveRow;
  layers: Layer[];
  groups: LayerGroup[];
}): LayerPanelActions {
  const layerId = targetLayerId(args.activeRow);

  if (layerId == null) {
    // A GROUP row (or a group-owned track) answers Delete — the group and every layer in it — while
    // the layer-scoped actions still ask for a layer. Audio answers nothing.
    const wt = workingTarget(args.activeRow);
    const groupId = wt.kind === "group" && args.groups.some((g) => g.id === wt.id) ? wt.id : null;
    const members = groupId == null ? 0 : args.layers.filter((l) => l.groupId === groupId).length;
    const canDelGroup = groupId != null && canRemoveGroup(args.layers, args.groups, groupId);
    return {
      layerId: null,
      groupId,
      duplicate: { enabled: false, title: `Duplicate layer — ${SELECT_LAYER}` },
      merge: { enabled: false, title: `Merge down — ${SELECT_LAYER}` },
      group: { enabled: false, title: `New group — ${SELECT_LAYER}` },
      remove:
        groupId == null
          ? { enabled: false, title: `Delete layer — ${SELECT_LAYER}` }
          : canDelGroup
            ? {
                enabled: true,
                title: members
                  ? `Delete group and its ${members} layer${members === 1 ? "" : "s"}`
                  : "Delete group",
              }
            : {
                enabled: false,
                title: "Delete group — a project needs at least one drawing layer",
              },
    };
  }

  const canDup = canDuplicateLayer(args.layers, layerId);
  const mergeBlock = whyNotMergeDown(args.layers, args.groups, layerId);
  const canDel = canRemoveLayer(args.layers, layerId);

  return {
    layerId,
    groupId: null,
    duplicate: {
      enabled: canDup,
      title: canDup ? "Duplicate layer" : "Duplicate layer — only drawing layers duplicate",
    },
    merge: {
      enabled: !mergeBlock,
      title: mergeBlock ? `Merge down — ${MERGE_REASON[mergeBlock]}` : "Merge down",
    },
    group: { enabled: true, title: "New group" },
    remove: {
      enabled: canDel,
      title: canDel ? "Delete layer" : "Delete layer — a project needs at least one drawing layer",
    },
  };
}
