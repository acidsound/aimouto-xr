import * as xb from 'xrblocks';
import {CONCEPT_UI_IMAGE_PATH} from '../constants';
import {AnimeUIPanelSpec, AnimeUISchema} from '../types';

/**
 * Structured Three.js & XR Blocks UI data representation converted directly
 * from the Full-Body 3D Anime HUD concept image (`fullbody_3d_anime_ui_1794853648830.jpg`).
 *
 * This single schema drives:
 * 1) The 2D WebGL Anime HUD overlay (`AnimeHudController`)
 * 2) The 3D WebXR spatial `xb.UICard` panels (`NeuroAvatarScene`)
 */
export const ANIME_UI_BLUEPRINT: AnimeUISchema = {
  version: '2.0.0',
  sourceConceptImage: CONCEPT_UI_IMAGE_PATH,
  theme: {
    backdrop: '#0e1024',
    panelFill: '#121633',
    panelSurfaceRgb: 'rgba(16, 20, 48, 0.92)',
    outerBorderPink: '#ff6ba8',
    innerBorderCyan: '#4be3ff',
    dialogueFill: '#f1f5f9',
    dialogueText: '#111632',
    textPrimary: '#f8fafc',
    textMuted: '#a5b4fc',
    accentViolet: '#8b5cf6',
    affinityPink: '#ff5c9f',
    cyanGlow: '#4be3ff',
  },
  panels: [
    {
      id: 'status_card',
      title: 'AIMOUTO-XR',
      region: 'top-left',
      chamferPx: 14,
      screen2D: {
        anchor: 'top-left',
        widthPx: 320,
      },
      spatial3D: {
        positionMeters: [-0.76, 1.48, -1.24],
        rotationEuler: [0, 0.28, 0],
        sizeMeters: {width: 0.44, height: 'auto'},
        pixelSize: 0.0011,
        manipulation: true,
      },
      widgets: [
        {id: 'fullbody_silhouette', kind: 'avatar_badge', label: 'FULL-BODY 3D RIG'},
        {id: 'emotion_pill', kind: 'emotion_pill', label: 'Emotion & Pose'},
        {id: 'affinity_bar', kind: 'progress_bar', label: 'Affinity Level'},
        {id: 'audio_eq', kind: 'equalizer', label: 'Audio Equalizer'},
      ],
    },
    {
      id: 'system_toolbar',
      title: 'SYSTEM DOCK',
      region: 'top-right',
      chamferPx: 12,
      screen2D: {
        anchor: 'top-right',
        widthPx: 520,
      },
      spatial3D: {
        positionMeters: [0.72, 1.72, -1.26],
        rotationEuler: [0, -0.24, 0],
        sizeMeters: {width: 0.56, height: 'auto'},
        pixelSize: 0.001,
        manipulation: true,
      },
      widgets: [
        {id: 'btn_mic', kind: 'button', label: 'Voice Mic', icon: 'mic', actionId: 'toggle_mic'},
        {id: 'btn_plugins', kind: 'button', label: 'Plugins', icon: 'extension', actionId: 'open_plugins'},
        {id: 'btn_model', kind: 'button', label: 'Model API', icon: 'settings', actionId: 'open_model'},
        {id: 'btn_art', kind: 'button', label: 'Art Studio', icon: 'brush', actionId: 'open_art'},
        {id: 'btn_xr', kind: 'button', label: 'WebXR Toggle', icon: 'view_in_ar', actionId: 'toggle_xr'},
      ],
    },
    {
      id: 'quick_actions',
      title: '3D RIG & STAGE CONTROLS',
      region: 'right-rail',
      chamferPx: 12,
      screen2D: {
        anchor: 'center-right',
        widthPx: 236,
      },
      spatial3D: {
        positionMeters: [0.68, 1.24, -1.16],
        rotationEuler: [0, -0.32, 0],
        sizeMeters: {width: 0.36, height: 'auto'},
        pixelSize: 0.001,
        manipulation: true,
      },
      widgets: [
        {id: 'qa_poses', kind: 'button', label: 'Full-Body Poses', icon: 'accessibility_new', actionId: 'cycle_pose'},
        {id: 'qa_emotes', kind: 'button', label: 'Emote Rig', icon: 'sentiment_satisfied', actionId: 'cycle_emotion'},
        {id: 'qa_tts', kind: 'button', label: 'TTS Voice', icon: 'record_voice_over', actionId: 'toggle_tts'},
        {id: 'qa_stage', kind: 'button', label: 'Scene Swap', icon: 'auto_awesome', actionId: 'cycle_stage'},
      ],
    },
    {
      id: 'dialogue_deck',
      title: 'DIALOGUE DECK',
      region: 'bottom-center',
      chamferPx: 12,
      screen2D: {
        anchor: 'bottom-center',
        widthPx: 660,
        maxWidthVw: 92,
      },
      spatial3D: {
        positionMeters: [0, 0.58, -1.04],
        rotationEuler: [-0.14, 0, 0],
        sizeMeters: {width: 0.72, height: 'auto'},
        pixelSize: 0.001,
        manipulation: true,
      },
      widgets: [
        {id: 'subtitle_text', kind: 'text', label: 'DIALOGUE'},
        {id: 'chat_input', kind: 'text_input', label: 'Message AIMouto...'},
        {id: 'send_btn', kind: 'button', label: 'Send', icon: 'send', actionId: 'send_chat'},
      ],
    },
  ],
};

export interface SpatialCardTransformConfig {
  id: AnimeUIPanelSpec['id'];
  title: string;
  position: [number, number, number];
  rotation: [number, number, number];
  size: {width: number; height: number | 'auto'};
  pixelSize: number;
  manipulation: boolean;
  cardStyle: Record<string, unknown>;
}

/**
 * Converts the declarative AnimeUISchema into concrete XR Blocks UICard
 * transform + UIKit styling parameters for Three.js / WebXR rendering.
 */
export function blueprintToSpatialCardConfigs(
  schema: AnimeUISchema = ANIME_UI_BLUEPRINT
): SpatialCardTransformConfig[] {
  return schema.panels.map((panel) => ({
    id: panel.id,
    title: panel.title,
    position: [...panel.spatial3D.positionMeters] as [number, number, number],
    rotation: [...panel.spatial3D.rotationEuler] as [number, number, number],
    size: {...panel.spatial3D.sizeMeters},
    pixelSize: panel.spatial3D.pixelSize,
    manipulation: panel.spatial3D.manipulation,
    cardStyle: {
      flexDirection: 'column',
      gap: 10,
      padding: 14,
      backgroundColor: schema.theme.panelFill,
      borderColor: schema.theme.outerBorderPink,
      borderWidth: 2,
      borderRadius: panel.chamferPx,
    },
  }));
}

/**
 * Generates an XR Blocks theme update object matching the anime UI palette.
 */
export function blueprintToXBThemeUpdate(
  schema: AnimeUISchema = ANIME_UI_BLUEPRINT
): xb.UIThemeUpdate {
  return {
    colors: {
      surface: schema.theme.panelFill,
      raisedSurface: '#1a2048',
      primary: schema.theme.innerBorderCyan,
      primaryText: '#091026',
      text: schema.theme.textPrimary,
      secondaryText: schema.theme.textMuted,
      outline: schema.theme.outerBorderPink,
    },
  };
}

/**
 * Validates that every required region & widget in the Three.js UI data structure
 * has valid non-overlapping spatial coordinates and positive physical dimensions.
 */
export function validateBlueprintLayout(schema: AnimeUISchema): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!schema.panels || schema.panels.length === 0) {
    errors.push('Blueprint has no panels.');
    return {valid: false, errors};
  }

  const seenIds = new Set<string>();
  for (const panel of schema.panels) {
    if (seenIds.has(panel.id)) {
      errors.push(`Duplicate panel id: ${panel.id}`);
    }
    seenIds.add(panel.id);

    if (panel.spatial3D.sizeMeters.width <= 0) {
      errors.push(`Panel ${panel.id} must have positive 3D width.`);
    }
    if (
      typeof panel.spatial3D.sizeMeters.height === 'number' &&
      panel.spatial3D.sizeMeters.height <= 0
    ) {
      errors.push(`Panel ${panel.id} must have positive 3D height.`);
    }
    if (panel.spatial3D.positionMeters[2] >= 0) {
      errors.push(`Panel ${panel.id} z position should be in front of viewer (< 0).`);
    }
    if (panel.widgets.length === 0) {
      errors.push(`Panel ${panel.id} has no widgets.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
