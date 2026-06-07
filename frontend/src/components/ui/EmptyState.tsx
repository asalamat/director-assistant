interface EmptyStateProps {
  icon: string | React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const sizes = {
  sm: { wrap: 'py-8 gap-2',  icon: 'text-3xl w-12 h-12', title: 'text-sm', desc: 'text-xs' },
  md: { wrap: 'py-16 gap-3', icon: 'text-4xl w-16 h-16', title: 'text-sm', desc: 'text-xs' },
  lg: { wrap: 'py-20 gap-4', icon: 'text-5xl w-20 h-20', title: 'text-base', desc: 'text-sm' },
}

export function EmptyState({ icon, title, description, action, size = 'md' }: EmptyStateProps) {
  const s = sizes[size]
  return (
    <div className={`flex flex-col items-center justify-center ${s.wrap} animate-fade-in`}>
      <div className={`${s.icon} rounded-2xl bg-gray-50 flex items-center justify-center flex-shrink-0`}>
        {typeof icon === 'string' ? <span className={s.icon}>{icon}</span> : icon}
      </div>
      <div className="text-center space-y-1">
        <p className={`font-semibold text-gray-700 ${s.title}`}>{title}</p>
        {description && (
          <p className={`text-gray-400 max-w-xs leading-relaxed ${s.desc}`}>{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
