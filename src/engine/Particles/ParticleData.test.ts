import { describe, it, expect } from 'vitest';
import { ParticleData } from './ParticleData';

describe('ParticleData', () => {
  it('constructs with default values', () => {
    const p = new ParticleData();
    expect(p.position.x).toBe(0);
    expect(p.position.y).toBe(0);
    expect(p.position.z).toBe(0);
    expect(p.velocity.x).toBe(0);
    expect(p.life).toBe(0);
    expect(p.maxLife).toBe(1);
    expect(p.size).toBe(0.1);
    expect(p.alive).toBe(true);
    expect(p.customData).toEqual([]);
  });

  it('isAlive returns true when alive and life < maxLife', () => {
    const p = new ParticleData();
    p.alive = true;
    p.life = 0.5;
    p.maxLife = 1;
    expect(p.isAlive()).toBe(true);
  });

  it('isAlive returns false when life exceeds maxLife', () => {
    const p = new ParticleData();
    p.life = 1.5;
    p.maxLife = 1;
    expect(p.isAlive()).toBe(false);
  });

  it('isAlive returns false when alive flag is false', () => {
    const p = new ParticleData();
    p.alive = false;
    p.life = 0;
    p.maxLife = 1;
    expect(p.isAlive()).toBe(false);
  });

  it('reset clears all mutable state to defaults', () => {
    const p = new ParticleData();
    p.position.set(5, 6, 7);
    p.velocity.set(1, 2, 3);
    p.acceleration.set(0, -9.8, 0);
    p.color.setRGB(0.5, 0.5, 0.5);
    p.startColor.setRGB(0.1, 0.2, 0.3);
    p.endColor.setRGB(0.9, 0.8, 0.7);
    p.size = 0.5;
    p.startSize = 0.3;
    p.endSize = 0.1;
    p.life = 2;
    p.maxLife = 3;
    p.rotation = 1.5;
    p.angularVelocity = 0.5;
    p.customData.push(1, 2, 3);
    p.alive = false;

    p.reset();

    expect(p.position.x).toBe(0);
    expect(p.position.y).toBe(0);
    expect(p.position.z).toBe(0);
    expect(p.velocity.x).toBe(0);
    expect(p.velocity.y).toBe(0);
    expect(p.velocity.z).toBe(0);
    expect(p.acceleration.x).toBe(0);
    expect(p.acceleration.y).toBe(0);
    expect(p.acceleration.z).toBe(0);
    expect(p.color.r).toBe(1);
    expect(p.color.g).toBe(1);
    expect(p.color.b).toBe(1);
    expect(p.startColor.r).toBe(1);
    expect(p.endColor.r).toBe(1);
    expect(p.size).toBe(0.1);
    expect(p.startSize).toBe(0.1);
    expect(p.endSize).toBe(0.1);
    expect(p.life).toBe(0);
    expect(p.maxLife).toBe(1);
    expect(p.rotation).toBe(0);
    expect(p.angularVelocity).toBe(0);
    expect(p.customData.length).toBe(0);
    expect(p.alive).toBe(true);
  });

  it('reset can be called multiple times safely', () => {
    const p = new ParticleData();
    p.reset();
    p.reset();
    expect(p.isAlive()).toBe(true);
  });

  it('customData is independent between instances', () => {
    const a = new ParticleData();
    const b = new ParticleData();
    a.customData.push(42);
    expect(b.customData.length).toBe(0);
    expect(a.customData[0]).toBe(42);
  });
});
