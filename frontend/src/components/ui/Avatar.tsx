const GRADIENTS = [
  'from-blue-500 to-indigo-600',
  'from-violet-500 to-purple-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-teal-500 to-cyan-600',
  'from-emerald-500 to-green-600',
]

function gradientFor(seed: string): string {
  let hash = 0
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff
  return GRADIENTS[hash % GRADIENTS.length]
}

function initialsOf(name: string): string {
  const cleaned = name.replace(/<[^>]+>/, '').trim()
  const parts = cleaned.split(/\s+/)
  return parts.slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('')
}

type Size = 'xs' | 'sm' | 'md' | 'lg'

const sizes: Record<Size, { outer: string; text: string }> = {
  xs: { outer: 'w-6 h-6',   text: 'text-[9px]'  },
  sm: { outer: 'w-8 h-8',   text: 'text-[11px]' },
  md: { outer: 'w-10 h-10', text: 'text-sm'      },
  lg: { outer: 'w-12 h-12', text: 'text-base'    },
}

interface AvatarProps {
  name: string
  size?: Size
  className?: string
}

export function Avatar({ name, size = 'sm', className = '' }: AvatarProps) {
  const { outer, text } = sizes[size]
  const gradient = gradientFor(name)
  return (
    <div className={`flex-shrink-0 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center
      ${outer} ${className}`}>
      <span className={`text-white font-semibold leading-none ${text}`}>
        {initialsOf(name) || '?'}
      </span>
    </div>
  )
}
