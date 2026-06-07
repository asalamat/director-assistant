type Variant = 'default' | 'info' | 'success' | 'warning' | 'danger' | 'purple' | 'orange' | 'new'

interface BadgeProps {
  variant?: Variant
  children: React.ReactNode
  dot?: boolean
  className?: string
}

const variants: Record<Variant, string> = {
  default: 'bg-gray-100 text-gray-600',
  info:    'bg-accent-100 text-accent-600',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  danger:  'bg-red-100 text-red-700',
  purple:  'bg-purple-100 text-purple-700',
  orange:  'bg-orange-100 text-orange-700',
  new:     'bg-emerald-500 text-white',
}

const dotColors: Record<Variant, string> = {
  default: 'bg-gray-400',
  info:    'bg-accent-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger:  'bg-red-500',
  purple:  'bg-purple-500',
  orange:  'bg-orange-500',
  new:     'bg-white',
}

export function Badge({ variant = 'default', children, dot, className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-full
      ${variants[variant]} ${className}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColors[variant]}`} />}
      {children}
    </span>
  )
}
