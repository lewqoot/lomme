export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message)
  }
}

export const notFound = (message = 'Объект не найден') => new AppError(404, 'NOT_FOUND', message)
export const forbidden = (message = 'Недостаточно прав') => new AppError(403, 'FORBIDDEN', message)
export const conflict = (message = 'Данные уже были изменены') => new AppError(409, 'VERSION_CONFLICT', message)
