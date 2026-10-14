import { describe, expect, it } from 'vitest';

type BraceOptions = {
  escapeInvalid?: boolean;
  expand?: boolean;
  maxDepth?: number;
};

type BraceAst = {
  type: string;
  value?: string;
  nodes?: BraceAst[];
  parent?: BraceAst;
};

type BracesApi = {
  (input: string | string[], options?: BraceOptions): string[];
  compile(input: string | BraceAst, options?: BraceOptions): string;
  expand(input: string | BraceAst, options?: BraceOptions): string[];
  parse(input: string, options?: BraceOptions): BraceAst;
  stringify(input: string | BraceAst, options?: BraceOptions): string;
};

const braces = require('braces') as BracesApi;
const bracesPackage = require('braces/package.json') as { version: string };

function deeplyNestedAst(): BraceAst {
  let ast: BraceAst = { type: 'text', value: 'a' };
  for (let depth = 0; depth < 101; depth++) {
    ast = { type: 'brace', nodes: [ast] };
  }
  return { type: 'root', nodes: [ast] };
}

describe('patched braces dependency', () => {
  it('loads the locally patched package and preserves ordinary behavior', () => {
    expect(bracesPackage.version).toBe('3.0.4');
    expect(braces('src/{core,testing}/*.cjs')).toEqual(['src/(core|testing)/*.cjs']);
    expect(braces('src/{core,testing}/*.cjs', { expand: true })).toEqual([
      'src/core/*.cjs',
      'src/testing/*.cjs',
    ]);
  });

  it('rejects deeply nested string input before recursive AST processing', () => {
    const pattern = '{'.repeat(101) + 'a,b' + '}'.repeat(101);
    expect(() => braces(pattern)).toThrow(/exceeds max depth/);
    expect(() => braces.expand(pattern)).toThrow(/exceeds max depth/);
  });

  it('rejects deeply nested caller-supplied ASTs at every recursive walker', () => {
    expect(() => braces.compile(deeplyNestedAst())).toThrow(/exceeds max depth/);
    expect(() => braces.expand(deeplyNestedAst())).toThrow(/exceeds max depth/);
    expect(() => braces.stringify(deeplyNestedAst())).toThrow(/exceeds max depth/);
  });

  it('rejects cyclic caller-supplied AST parent chains', () => {
    const ast: BraceAst = { type: 'paren', nodes: [{ type: 'text', value: 'a' }] };
    ast.parent = ast;
    expect(() => braces.expand(ast)).toThrow(/parent chain contains a cycle/);
  });

  it('does not escape valid nested braces when escapeInvalid is enabled', () => {
    for (const pattern of ['{{a}}', '{a,{b}}', '{{x}y}', '{a,{b,{c}}', '{}{a}']) {
      expect(braces.stringify(braces.parse(pattern), { escapeInvalid: true })).toBe(pattern);
    }
  });
});
