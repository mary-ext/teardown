type BufferShim = {
	alloc(size: number): Uint8Array;
	from(
		value: ArrayBufferLike | ArrayBufferView | ArrayLike<number> | string,
		byteOffsetOrEncoding?: number | string,
		length?: number,
	): Uint8Array;
	isBuffer(value: unknown): boolean;
};

const encoder = new TextEncoder();

const from: BufferShim['from'] = (value, byteOffsetOrEncoding, length) => {
	if (typeof value === 'string') {
		return encoder.encode(value);
	}

	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
	}

	if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) {
		const byteOffset = typeof byteOffsetOrEncoding === 'number' ? byteOffsetOrEncoding : 0;
		return new Uint8Array(value, byteOffset, length);
	}

	return Uint8Array.from(value);
};

const Buffer = Object.assign(
	function Buffer(): never {
		throw new TypeError('Buffer constructor is not supported in this worker shim');
	},
	{
		alloc: (size: number): Uint8Array => new Uint8Array(size),
		from,
		isBuffer: (value: unknown): boolean => value instanceof Uint8Array,
	},
);

// oxlint-disable-next-line typescript/no-unsafe-type-assertion
(globalThis as any).Buffer ??= Buffer;
