import { describe, expect, it } from 'vitest';

import { isolate } from './isolate';
import type { IsolatedResult, ResolvedPackage } from './types';

// #region test helpers

/**
 * peers also listed in `deps` act as auto-installed fallbacks.
 */
const pkg = (spec: string, deps: ResolvedPackage[] = [], peers: string[] = []): ResolvedPackage => {
	const at = spec.lastIndexOf('@');
	const [name, version] = at > 0 ? [spec.slice(0, at), spec.slice(at + 1)] : [spec, '1.0.0'];

	return {
		name,
		version,
		tarball: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
		dependencies: new Map(deps.map((d) => [d.name, d])),
		peers: new Map(peers.map((peer) => [peer, '*'])),
	};
};

const describeLayout = (result: IsolatedResult): string[] => {
	const lines: string[] = [];
	for (const [id, entry] of result.entries) {
		const links = [...entry.links].map(([name, target]) => `${name} -> ${target}`).toSorted();
		lines.push(`${id}: ${links.join(', ')}`);
	}
	return lines.toSorted();
};

// #endregion

describe('isolate', () => {
	it('links each package to its own dependencies', () => {
		const b = pkg('b');
		const result = isolate([pkg('a', [b, pkg('c', [b])])]);

		expect(describeLayout(result)).toEqual([
			'a@1.0.0: b -> b@1.0.0, c -> c@1.0.0',
			'b@1.0.0: ',
			'c@1.0.0: b -> b@1.0.0',
		]);
		expect([...result.roots]).toEqual([['a', 'a@1.0.0']]);
	});

	it('gives every dependent the version it asked for', () => {
		const x1 = pkg('x@1.0.0');
		const x2 = pkg('x@2.0.0');
		const result = isolate([pkg('root', [x2, pkg('a', [x1]), pkg('b', [x1])])]);

		expect(describeLayout(result)).toEqual([
			'a@1.0.0: x -> x@1.0.0',
			'b@1.0.0: x -> x@1.0.0',
			'root@1.0.0: a -> a@1.0.0, b -> b@1.0.0, x -> x@2.0.0',
			'x@1.0.0: ',
			'x@2.0.0: ',
		]);
	});

	it('encodes scoped names into a single path segment', () => {
		const result = isolate([pkg('@scope/a')]);

		expect([...result.entries.keys()]).toEqual(['@scope+a@1.0.0']);
		expect([...result.roots]).toEqual([['@scope/a', '@scope+a@1.0.0']]);
	});

	describe('peer dependencies', () => {
		it('links peers to the version the dependent provides', () => {
			const lib = pkg('lib', [pkg('react@19.0.0')], ['react']);
			const result = isolate([pkg('app', [pkg('react@18.0.0'), lib])]);

			expect(describeLayout(result)).toEqual([
				'app@1.0.0: lib -> lib@1.0.0(react@18.0.0), react -> react@18.0.0',
				'lib@1.0.0(react@18.0.0): react -> react@18.0.0',
				'react@18.0.0: ',
			]);
		});

		it('falls back to the auto-installed peer', () => {
			const result = isolate([pkg('lib', [pkg('react@19.0.0')], ['react'])]);

			expect(describeLayout(result)).toEqual([
				'lib@1.0.0(react@19.0.0): react -> react@19.0.0',
				'react@19.0.0: ',
			]);
			// shared peers get no root link
			expect([...result.roots]).toEqual([['lib', 'lib@1.0.0(react@19.0.0)']]);
		});

		it('shares one auto-installed peer between packages missing it', () => {
			// b inherits react under a but needs a fallback under c
			const react = pkg('react@19.0.0');
			const b = pkg('b', [react], ['react']);
			const result = isolate([pkg('a', [react, b], ['react']), pkg('c', [b])]);

			expect(describeLayout(result)).toEqual([
				'a@1.0.0(react@19.0.0): b -> b@1.0.0(react@19.0.0), react -> react@19.0.0',
				'b@1.0.0(react@19.0.0): react -> react@19.0.0',
				'c@1.0.0(react@19.0.0): b -> b@1.0.0(react@19.0.0)',
				'react@19.0.0: ',
			]);
		});

		it('shares the highest version satisfying every fallback range', () => {
			const lib18 = pkg('lib18', [pkg('react@18.3.1')], []);
			lib18.peers.set('react', '^18.0.0');
			const libAny = pkg('lib-any', [pkg('react@19.0.0')], []);
			libAny.peers.set('react', '>=16');
			const result = isolate([pkg('app', [lib18, libAny])]);

			expect(describeLayout(result).filter((line) => line.startsWith('react@'))).toEqual(['react@18.3.1: ']);
		});

		it('keeps separate fallbacks when no version satisfies every range', () => {
			const lib18 = pkg('lib18', [pkg('react@18.3.1')], []);
			lib18.peers.set('react', '^18.0.0');
			const lib19 = pkg('lib19', [pkg('react@19.0.0')], []);
			lib19.peers.set('react', '^19.0.0');
			const result = isolate([pkg('app', [lib18, lib19])]);

			expect(describeLayout(result)).toEqual([
				'app@1.0.0: lib18 -> lib18@1.0.0, lib19 -> lib19@1.0.0',
				'lib18@1.0.0: react -> react@18.3.1',
				'lib19@1.0.0: react -> react@19.0.0',
				'react@18.3.1: ',
				'react@19.0.0: ',
			]);
		});

		it('leaves missing optional peers unlinked', () => {
			const result = isolate([pkg('lib', [], ['react'])]);

			expect(describeLayout(result)).toEqual(['lib@1.0.0: ']);
		});

		it('lets root packages provide peers to each other', () => {
			const result = isolate([pkg('lib', [], ['react']), pkg('react@18.0.0')]);

			expect(describeLayout(result)).toEqual([
				'lib@1.0.0(react@18.0.0): react -> react@18.0.0',
				'react@18.0.0: ',
			]);
		});

		it('specialises dependents of packages that need peers from further up', () => {
			const lib = pkg('lib', [], ['react']);
			const result = isolate([pkg('app', [pkg('react@18.0.0'), pkg('wrapper', [lib])])]);

			expect(describeLayout(result)).toEqual([
				'app@1.0.0: react -> react@18.0.0, wrapper -> wrapper@1.0.0(react@18.0.0)',
				'lib@1.0.0(react@18.0.0): react -> react@18.0.0',
				'react@18.0.0: ',
				'wrapper@1.0.0(react@18.0.0): lib -> lib@1.0.0(react@18.0.0)',
			]);
		});

		it('does not specialise dependents that provide the peer themselves', () => {
			const lib = pkg('lib', [], ['react']);
			const result = isolate([pkg('app', [pkg('react@18.0.0'), pkg('wrapper', [pkg('react@17.0.0'), lib])])]);

			expect(describeLayout(result)).toEqual([
				'app@1.0.0: react -> react@18.0.0, wrapper -> wrapper@1.0.0',
				'lib@1.0.0(react@17.0.0): react -> react@17.0.0',
				'react@17.0.0: ',
				'react@18.0.0: ',
				'wrapper@1.0.0: lib -> lib@1.0.0(react@17.0.0), react -> react@17.0.0',
			]);
		});

		it('tells peers apart by their own peers', () => {
			// dom needs react, lib needs dom; both dependents provide the same dom version
			const dom = pkg('dom', [], ['react']);
			const lib = pkg('lib', [], ['dom']);
			const result = isolate([
				pkg('app', [pkg('a', [pkg('react@17.0.0'), dom, lib]), pkg('b', [pkg('react@18.0.0'), dom, lib])]),
			]);

			expect(describeLayout(result).filter((line) => /^(dom|lib)@/.test(line))).toEqual([
				'dom@1.0.0(react@17.0.0): react -> react@17.0.0',
				'dom@1.0.0(react@18.0.0): react -> react@18.0.0',
				'lib@1.0.0(dom@1.0.0(react@17.0.0)): dom -> dom@1.0.0(react@17.0.0)',
				'lib@1.0.0(dom@1.0.0(react@18.0.0)): dom -> dom@1.0.0(react@18.0.0)',
			]);
		});

		it('ends ids of peers that are peers of each other', () => {
			const result = isolate([pkg('app', [pkg('a', [], ['b']), pkg('b', [], ['a'])])]);

			expect(describeLayout(result)).toEqual([
				'a@1.0.0(b@1.0.0(a@1.0.0)): b -> b@1.0.0(a@1.0.0(b@1.0.0))',
				'app@1.0.0: a -> a@1.0.0(b@1.0.0(a@1.0.0)), b -> b@1.0.0(a@1.0.0(b@1.0.0))',
				'b@1.0.0(a@1.0.0(b@1.0.0)): a -> a@1.0.0(b@1.0.0(a@1.0.0))',
			]);
		});

		it('shortens long ids', () => {
			const peers = Array.from({ length: 12 }, (_, i) => `peer-with-a-long-name-${i}`);
			const lib = pkg('lib', [], peers);
			const app = pkg('app', [...peers.map((name) => pkg(name)), lib]);
			const ids = [...isolate([app]).entries.keys()].filter((id) => id.startsWith('lib@'));

			expect(ids).toHaveLength(1);
			expect(ids[0]).toHaveLength(120);
			expect(ids[0]).toMatch(/^lib@1\.0\.0\(peer-with-a-long-name-0@1\.0\.0\).*_[0-9a-f]{16}$/);
		});

		it('creates one entry per peer combination', () => {
			const lib = pkg('lib', [], ['react']);
			const result = isolate([
				pkg('app', [pkg('a', [pkg('react@17.0.0'), lib]), pkg('b', [pkg('react@18.0.0'), lib])]),
			]);

			expect([...result.entries.keys()].filter((id) => id.startsWith('lib@'))).toEqual([
				'lib@1.0.0(react@17.0.0)',
				'lib@1.0.0(react@18.0.0)',
			]);
		});
	});

	describe('cyclic dependencies', () => {
		it('links cycles back to the same entry', () => {
			const a = pkg('a');
			const b = pkg('b', [a]);
			a.dependencies.set('b', b);

			expect(describeLayout(isolate([a]))).toEqual(['a@1.0.0: b -> b@1.0.0', 'b@1.0.0: a -> a@1.0.0']);
		});

		it('keeps peer contexts apart through cycles', () => {
			// a -> b -> a; a -> c requires an ancestor-provided react
			const make = (order: 'b-first' | 'c-first') => {
				const a = pkg('a');
				const b = pkg('b', [a]);
				const c = pkg('c', [], ['react']);
				a.dependencies = new Map(
					order === 'b-first'
						? [
								['b', b],
								['c', c],
							]
						: [
								['c', c],
								['b', b],
							],
				);
				return pkg('app', [pkg('x', [pkg('react@17.0.0'), a]), pkg('y', [pkg('react@18.0.0'), a])]);
			};

			for (const order of ['b-first', 'c-first'] as const) {
				const lines = describeLayout(isolate([make(order)]));

				expect(lines.filter((line) => /^[ab]@/.test(line))).toEqual([
					'a@1.0.0(react@17.0.0): b -> b@1.0.0(react@17.0.0), c -> c@1.0.0(react@17.0.0)',
					'a@1.0.0(react@18.0.0): b -> b@1.0.0(react@18.0.0), c -> c@1.0.0(react@18.0.0)',
					'b@1.0.0(react@17.0.0): a -> a@1.0.0(react@17.0.0)',
					'b@1.0.0(react@18.0.0): a -> a@1.0.0(react@18.0.0)',
				]);
			}
		});

		it('provides a package to the peers of its own dependencies', () => {
			// like react-native, whose dependencies peer on react-native
			const plugin = pkg('plugin', [], ['host']);
			const host = pkg('host', [plugin]);
			const result = isolate([pkg('app', [host])]);

			expect(describeLayout(result)).toEqual([
				'app@1.0.0: host -> host@1.0.0',
				'host@1.0.0: plugin -> plugin@1.0.0(host@1.0.0)',
				'plugin@1.0.0(host@1.0.0): host -> host@1.0.0',
			]);
		});

		it('skips self-dependencies', () => {
			const a = pkg('a');
			a.dependencies.set('a', a);

			expect(describeLayout(isolate([a]))).toEqual(['a@1.0.0: ']);
		});
	});

	it('hoists every package name for undeclared imports', () => {
		const result = isolate([pkg('a', [pkg('b', [pkg('c')])])]);

		expect([...result.hoisted.keys()].toSorted()).toEqual(['a', 'b', 'c']);
	});

	it('hoists the shallowest version of each package', () => {
		const result = isolate([pkg('lib', [pkg('dep', [pkg('react@17.0.0')])]), pkg('react@18.0.0')]);

		expect(result.hoisted.get('react')).toBe('react@18.0.0');
	});
});
