import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      let code: string;
      let message: string;

      if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'code' in exceptionResponse &&
        'message' in exceptionResponse
      ) {
        code = (exceptionResponse as { code: string; message: string }).code;
        message = (exceptionResponse as { code: string; message: string }).message;
      } else if (typeof exceptionResponse === 'object' && 'message' in exceptionResponse) {
        code = httpStatusToCode(status);
        const raw = (exceptionResponse as { message: string | string[] }).message;
        message = Array.isArray(raw) ? raw.join('; ') : raw;
      } else {
        code = httpStatusToCode(status);
        message = String(exceptionResponse);
      }

      response.status(status).json({
        success: false,
        error: { code, message },
      });
    } else {
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  }
}

function httpStatusToCode(status: number): string {
  const map: Record<number, string> = {
    400: 'VALIDATION_ERROR',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'UNPROCESSABLE_ENTITY',
    500: 'INTERNAL_SERVER_ERROR',
  };
  return map[status] ?? 'ERROR';
}
