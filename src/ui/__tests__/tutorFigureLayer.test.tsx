// @vitest-environment jsdom
// The classroom's figure layer (ui/TutorBackdrop): her layer sits on the scene's DEFAULT box, so zooming the background (背景) moves
// and scales only the picture; her place and size on screen stay as they are. Nothing is sent anywhere.
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TutorBackdrop } from '../TutorBackdrop';
import { BACKDROP_IDENTITY, DEFAULT_SCENE } from '../../game/tutorScene';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderBackdrop(view: { scale: number; x: number; y: number }) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const el = (v: typeof view) => (
    <TutorBackdrop src={DEFAULT_SCENE.file} anchored dim={0} view={v} dragging={false} gestures={false} onView={() => {}}
      figure={<div className="fake-figure">her</div>} />
  );
  act(() => { root.render(el(view)); });
  return {
    layer: () => host.querySelector<HTMLElement>('.tutor-figure-layer')!.getAttribute('style'),
    scene: () => host.querySelector<HTMLElement>('.tutor-scene')!.getAttribute('style'),
    rerender: (v: typeof view) => act(() => { root.render(el(v)); }),
    unmount: () => { act(() => root.unmount()); host.remove(); },
  };
}

describe('the figure layer of the classroom', () => {
  it('she is drawn in her own layer, not inside the scene', () => {
    const r = renderBackdrop(BACKDROP_IDENTITY);
    expect(r.layer()).toBeTruthy();
    expect(document.querySelector('.tutor-scene .fake-figure')).toBeNull();
    expect(document.querySelector('.tutor-figure-layer .fake-figure')).not.toBeNull();
    r.unmount();
  });

  it('a background zoom moves and scales the scene, but not her layer', () => {
    const r = renderBackdrop(BACKDROP_IDENTITY);
    const layerBefore = r.layer();
    const sceneBefore = r.scene();
    r.rerender({ scale: 2, x: 30, y: -20 });
    expect(r.scene()).not.toBe(sceneBefore);
    expect(r.layer()).toBe(layerBefore);
    r.unmount();
  });
});
