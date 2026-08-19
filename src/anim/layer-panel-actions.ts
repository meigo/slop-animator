import { targetLayerId, type ActiveRow } from "./active-row";
import {
  canDuplicateLayer,
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
    return {
      layerId: null,
      duplicate: { enabled: false, title: `Duplicate layer — ${SELECT_LAYER}` },
      merge: { enabled: false, title: `Merge down — ${SELECT_LAYER}` },
      group: { enabled: false, title: `New group — ${SELECT_LAYER}` },
      remove: { enabled: false, title: `Delete layer — ${SELECT_LAYER}` },
    };
  }

  const canDup = canDuplicateLayer(args.layers, layerId);
  const mergeBlock = whyNotMergeDown(args.layers, args.groups, layerId);
  const canDel = canRemoveLayer(args.layers, layerId);

  return {
    layerId,
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
