# Estrategia de tests

La suite sigue la arquitectura de producción y separa comportamiento aislado de contratos HTTP.

```text
tests/
├── fixtures/             # Objetos de dominio compartidos y estables
├── helpers/              # Utilidades pequeñas para HTTP, Drizzle y aserciones
├── integration/http/     # Requests reales contra app.handle
├── unit/lib/             # Funciones transversales puras
├── unit/modules/         # Modelos y servicios agrupados por módulo
└── setup.ts              # Entorno ficticio; nunca usa Turso o Groq reales
```

## Convenciones

- Un archivo prueba un módulo o contrato HTTP concreto.
- Los tests verifican comportamiento observable, no detalles internos.
- Los spies sobre singletons de Drizzle se ejecutan con `test.serial`.
- La persistencia y proveedores externos se aíslan en el límite de integración.
- Los fixtures se comparten solo cuando representan el mismo contrato de dominio.

## Comandos

```bash
bun test
bun run test:coverage
bun run typecheck
```

