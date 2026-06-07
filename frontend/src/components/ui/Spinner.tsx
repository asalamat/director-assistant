type Size = 'xs' | 'sm' | 'md' | 'lg'

const sizes: Record<Size, string> = {
  xs: 'w-3 h-3 border-[1.5px]',
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-8 h-8 border-[3px]',
}

export function Spinner({ size = 'md', className = '' }: { size?: Size; className?: string }) {
  return (
    <div className={`rounded-full border-accent-500 border-t-transparent animate-spin
      ${sizes[size]} ${className}`} />
  )
}

export function LoadingOverlay({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 py-12 animate-fade-in">
      <Spinner size="md" />
      <p className="text-sm text-gray-400">{text}</p>
    </div>
  )
}
