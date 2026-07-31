import { router } from '../trpc';
import { dashboardRouter } from './dashboard';
import { onboardingRouter } from './onboarding';
import { billingRouter } from './billing';
import { ingestionRouter } from './ingestion';

export const appRouter = router({
  dashboard: dashboardRouter,
  onboarding: onboardingRouter,
  billing: billingRouter,
  ingestion: ingestionRouter,
});

export type AppRouter = typeof appRouter;
