interface CardProps {
  children: React.ReactNode
  className?: string
  hoverable?: boolean
  onClick?: () => void
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

const paddings = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-6' }

export function Card({ children, className = '', hoverable, onClick, padding = 'md' }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`bg-white border border-gray-100 rounded-xl shadow-card
        ${hoverable || onClick ? 'cursor-pointer hover:shadow-card-md hover:border-gray-200 transition-all duration-150' : ''}
        ${paddings[padding]} ${className}`}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between mb-3 ${className}`}>
      {children}
    </div>
  )
}

export function CardTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 className={`text-sm font-semibold text-gray-800 ${className}`}>{children}</h3>
  )
}
