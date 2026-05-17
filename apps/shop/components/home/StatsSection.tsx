'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, useInView } from 'framer-motion'

const STATS = [
  { value: 10, suffix: '+', label: "Années d'expérience" },
  { value: 500, suffix: '+', label: 'Projets réalisés' },
  { value: 200, suffix: '+', label: 'Clients fidèles' },
  { value: 15, suffix: '', label: 'Techniciens qualifiés' },
]

function Counter({ target, suffix }: { target: number; suffix: string }) {
  const [count, setCount] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })

  useEffect(() => {
    if (!inView) return
    let start = 0
    const duration = 1800
    const step = Math.ceil(target / (duration / 16))
    const timer = setInterval(() => {
      start += step
      if (start >= target) {
        setCount(target)
        clearInterval(timer)
      } else {
        setCount(start)
      }
    }, 16)
    return () => clearInterval(timer)
  }, [inView, target])

  return (
    <span ref={ref} className="tabular-nums">
      {count}{suffix}
    </span>
  )
}

export function StatsSection() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })

  return (
    <section className="bg-white px-4 py-16 sm:py-20" ref={ref}>
      <div className="mx-auto max-w-5xl">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {STATS.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 24 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="flex flex-col items-center text-center"
            >
              <p className="text-4xl font-black text-forge-red sm:text-5xl">
                <Counter target={stat.value} suffix={stat.suffix} />
              </p>
              <p className="mt-2 text-sm font-medium text-forge-steel">{stat.label}</p>
              <div className="mt-3 h-0.5 w-8 rounded-full bg-forge-red/30" />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
