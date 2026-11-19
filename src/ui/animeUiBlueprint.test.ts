import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANIME_UI_BLUEPRINT,
  blueprintToSpatialCardConfigs,
  validateBlueprintLayout,
} from './animeUiBlueprint';

test('ANIME_UI_BLUEPRINT validates and converts cleanly into Three.js spatial card configs', () => {
  const validation = validateBlueprintLayout(ANIME_UI_BLUEPRINT);
  assert.equal(validation.valid, true, validation.errors.join('; '));
  assert.equal(ANIME_UI_BLUEPRINT.panels.length, 4);

  const spatialCards = blueprintToSpatialCardConfigs(ANIME_UI_BLUEPRINT);
  assert.equal(spatialCards.length, 4);

  for (const card of spatialCards) {
    assert.ok(card.size.width > 0);
    assert.ok(card.position[2] < 0);
    assert.equal(card.cardStyle.borderColor, ANIME_UI_BLUEPRINT.theme.outerBorderPink);
  }
});
