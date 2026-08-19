import { Hono } from 'hono'
import { requireAuth } from '../../middleware/auth.js'
import { usedBytes, MAX_BYTES_PER_USER } from '../../lib/quota.js'

const router = new Hono()
router.use('*', requireAuth)

router.get('/', (c) => {
  const user = c.get('user')
  return c.json({ usedBytes: usedBytes(user.id), limitBytes: MAX_BYTES_PER_USER })
})

export { router as usageRouter }
