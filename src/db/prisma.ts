import { DEV_MODE } from '../util.js'
import { PrismaClient } from 'grace-train-lib/prisma'

// https://www.prisma.io/docs/guides/performance-and-optimization/connection-management#prevent-hot-reloading-from-creating-new-instances-of-prismaclient
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

const prisma = globalForPrisma.prisma || new PrismaClient()
export default prisma

if (DEV_MODE) globalForPrisma.prisma = prisma
