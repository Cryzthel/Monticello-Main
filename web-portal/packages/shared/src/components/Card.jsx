export default function Card({ as: Component = 'div', className = '', children, ...rest }) {
  return (
    <Component className={`card ${className}`} {...rest}>
      {children}
    </Component>
  )
}
