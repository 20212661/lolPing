import { describe, expect, it } from 'vitest';
import { copySteps, encodeSteps, parseKeyCombo, tapSteps, triggerVkOf, vkOf } from '../../src/shared/keySteps';

describe('vkOf', () => {
  it('maps letters, digits, modifiers, named keys and function keys', () => {
    expect(vkOf('a')).toBe(0x41);
    expect(vkOf('z')).toBe(0x5a);
    expect(vkOf('7')).toBe(0x37);
    expect(vkOf('ctrl')).toBe(0x11);
    expect(vkOf('alt')).toBe(0x12);
    expect(vkOf('f5')).toBe(0x74);
    expect(vkOf('enter')).toBe(0x0d);
    expect(vkOf('=')).toBe(0xbb);
  });

  it('returns null for anything the table does not know', () => {
    expect(vkOf('nop')).toBeNull();
    expect(vkOf('')).toBeNull();
    expect(vkOf('AB')).toBeNull();
  });
});

describe('parseKeyCombo', () => {
  it('splits modifiers from one main key', () => {
    expect(parseKeyCombo('ctrl+shift+v')).toEqual([0x11, 0x10, 0x56]);
    expect(parseKeyCombo('c')).toEqual([0x43]);
    expect(parseKeyCombo('+')).toEqual([0xbb]);
  });

  it('accepts the mac names PopClip converts from', () => {
    expect(parseKeyCombo('ctrl+k')).toEqual([0x11, 0x4b]);
  });

  it('rejects two main keys, duplicate modifiers and unknown names', () => {
    expect(parseKeyCombo('a+b')).toBeNull();
    expect(parseKeyCombo('ctrl+ctrl+a')).toBeNull();
    expect(parseKeyCombo('ctrl+nop')).toBeNull();
    expect(parseKeyCombo('')).toBeNull();
  });
});

describe('tapSteps', () => {
  it('presses modifiers and the key, then releases in reverse', () => {
    expect(tapSteps('ctrl+c')).toEqual([
      { vk: 0x11, down: true }, { vk: 0x43, down: true },
      { vk: 0x43, down: false }, { vk: 0x11, down: false },
    ]);
  });

  it('returns null for a combo that does not parse', () => {
    expect(tapSteps('hyper+k')).toBeNull();
  });
});

describe('copySteps', () => {
  it('lifts the trigger, presses Ctrl+C, then holds the trigger again', () => {
    expect(copySteps(0x12)).toEqual([
      { vk: 0x12, down: false },
      { vk: 0x11, down: true }, { vk: 0x43, down: true },
      { vk: 0x43, down: false }, { vk: 0x11, down: false },
      { vk: 0x12, down: true },
    ]);
  });

  it('skips the lift for a mouse trigger or none', () => {
    expect(copySteps(null)).toEqual([
      { vk: 0x11, down: true }, { vk: 0x43, down: true },
      { vk: 0x43, down: false }, { vk: 0x11, down: false },
    ]);
  });
});

describe('encodeSteps', () => {
  it('encodes as the helper steps string', () => {
    expect(encodeSteps([{ vk: 0x12, down: false }, { vk: 0x11, down: true }])).toBe('18:0,17:1');
  });
});

describe('triggerVkOf', () => {
  it('maps every keyboard trigger and passes a custom vk through', () => {
    expect(triggerVkOf('alt')).toBe(0x12);
    expect(triggerVkOf('ctrl')).toBe(0x11);
    expect(triggerVkOf('shift')).toBe(0x10);
    expect(triggerVkOf('win')).toBe(0x5b);
    expect(triggerVkOf('capslock')).toBe(0x14);
    expect(triggerVkOf({ vk: 84 })).toBe(84);
  });

  it('returns null for mouse triggers, which cannot be lifted', () => {
    expect(triggerVkOf('mouse4')).toBeNull();
    expect(triggerVkOf('mouse5')).toBeNull();
  });
});
