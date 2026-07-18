/**
 * Contexto transitorio de automatización de una reserva. Existe solo en
 * memoria entre el RPC y las plantillas: nunca forma parte de ProcessLeadInput,
 * normalized_payload, eventos, logs ni correos internos.
 */
export interface ReservationEmailContext {
  /** Enlace privado con el token en claro; solo lo consume el correo del cliente. */
  manageUrl: string;
  /** Fotografía autoritativa devuelta por la misma transacción del RPC. */
  capacity: {
    total: number;
    used: number;
    remaining: number;
    /** true para human_review: la solicitud no consumió capacidad. */
    provisional: boolean;
  };
}
