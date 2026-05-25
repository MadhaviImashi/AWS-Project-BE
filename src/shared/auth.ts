import { Request, Response, NextFunction } from 'express';

export interface CognitoClaims {
  sub: string;
  email: string;
  name?: string;
  'cognito:groups'?: string;
  'cognito:username'?: string;
}

export const getClaims = (req: Request): CognitoClaims => {
  return (req as any).apiGateway?.event?.requestContext?.authorizer?.jwt?.claims ?? {};
};

export const getUserSub = (req: Request): string => {
  return getClaims(req).sub;
};

export const getUserEmail = (req: Request): string => {
  return getClaims(req).email;
};

export const isAdmin = (req: Request): boolean => {
  const groups = getClaims(req)['cognito:groups'] ?? '';
  return groups.includes('admins');
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
};
