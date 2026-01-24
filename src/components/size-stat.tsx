import { formatBytes, formatLongBytes } from '../lib/format';
import Tooltip from '../primitives/tooltip';

interface SizeStatProps {
	label: string;
	size: number;
}

const SizeStat = (props: SizeStatProps) => {
	return (
		<Tooltip content={formatLongBytes(props.size)} relationship="description">
			{(triggerProps) => (
				<div class="flex flex-col gap-1" {...triggerProps}>
					<span class="text-base-300 text-neutral-foreground-3">{props.label}</span>
					<span class="text-base-500 font-semibold text-neutral-foreground-1">{formatBytes(props.size)}</span>
				</div>
			)}
		</Tooltip>
	);
};

export default SizeStat;
