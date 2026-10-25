import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Enable Global CORS for frontend integration
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Global API Prefix: /api
  app.setGlobalPrefix('api');

  // Global DTO Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // OpenAPI / Swagger Documentation Setup
  const config = new DocumentBuilder()
    .setTitle('Saylani HCM Lite — Backend REST API')
    .setDescription(
      'Complete production-ready REST API for HCM Lite (AI-assisted Human Capital Management System). Includes M1 Authentication, M2 Organization Setup, M3 Employee Management, M4 Attendance, M5 Leave Management, M6 Payroll Lite, M7 Analytics Dashboards, M8 AI Assistant, and M9 Communications & Audit Logs.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter your JWT token (Bearer token) obtained from /api/auth/login',
        in: 'header',
      },
      'bearer',
    )
    .addTag('M1: Authentication')
    .addTag('M2: Organization Setup')
    .addTag('M3: Employee Management')
    .addTag('M4: Attendance')
    .addTag('M5: Leave Management')
    .addTag('M6: Payroll Lite')
    .addTag('M7: Dashboards and Analytics')
    .addTag('M8: AI Assistant')
    .addTag('M9: Communications')
    .addTag('M9: Audit Logs')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'HCM Lite — API Documentation',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
    },
  });

  const port = process.env.PORT || 5000;
  await app.listen(port);

  logger.log(`=======================================================`);
  logger.log(`🚀 HCM Lite Backend Server running on port ${port}`);
  logger.log(`📡 Base API URL: http://localhost:${port}/api`);
  logger.log(`📚 Swagger Documentation: http://localhost:${port}/api/docs`);
  logger.log(`=======================================================`);
}

bootstrap();
