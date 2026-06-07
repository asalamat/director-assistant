import { forwardRef, InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: React.ReactNode
  iconRight?: React.ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
  label, error, icon, iconRight, className = '', ...props
}, ref) => {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      )}
      <div className="relative">
        {icon && (
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            {icon}
          </span>
        )}
        <input
          ref={ref}
          className={`w-full bg-white border rounded-lg text-sm text-gray-900
            placeholder-gray-400 transition-all duration-150
            focus:outline-none focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500
            disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed
            ${error ? 'border-red-400 focus:ring-red-400/30 focus:border-red-400' : 'border-gray-200 hover:border-gray-300'}
            ${icon ? 'pl-8' : 'pl-3'} ${iconRight ? 'pr-8' : 'pr-3'} py-2
            ${className}`}
          {...props}
        />
        {iconRight && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400">
            {iconRight}
          </span>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
})
Input.displayName = 'Input'
