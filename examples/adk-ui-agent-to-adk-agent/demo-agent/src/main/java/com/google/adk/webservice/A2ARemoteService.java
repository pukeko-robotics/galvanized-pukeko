package com.google.adk.webservice;

import io.a2a.spec.JSONRPCError;
import io.a2a.spec.SendMessageRequest;
import io.a2a.spec.SendMessageResponse;
import io.a2a.transport.jsonrpc.handler.JSONRPCHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
// WARNING adapted from https://github.com/google/adk-java/tree/main/a2a (absent in google-adk-a2a)
/**
 * Core service that bridges the A2A JSON-RPC sendMessage API to a local ADK runner.
 *
 * <p><b>ADK 1.6.0 note:</b> delegates to the a2a-java {@link JSONRPCHandler} (backed by ADK's
 * {@code AgentExecutor} + {@code DefaultRequestHandler}), which performs A2A message processing,
 * context/task-id management, and JSON-RPC error mapping. The pre-1.0
 * {@code A2ASendMessageExecutor.execute(Message).blockingGet()} single-shot bridge and the manual
 * {@code ResponseConverter.eventsToMessage} fallback were removed at GA.
 *
 * @apiNote <b>EXPERIMENTAL:</b> Subject to change, rename, or removal in any future patch release. Do
 *     not use in production code.
 */
@Service
public class A2ARemoteService {

  private static final Logger logger = LoggerFactory.getLogger(A2ARemoteService.class);
  private static final int ERROR_CODE_INVALID_PARAMS = -32602;

  private final JSONRPCHandler handler;

  public A2ARemoteService(JSONRPCHandler handler) {
    this.handler = handler;
  }

  public SendMessageResponse handle(SendMessageRequest request) {
    if (request == null) {
      logger.warn("Received null SendMessageRequest");
      return invalidParamsResponse(null, "Request body is missing");
    }

    if (request.getParams() == null) {
      logger.warn("SendMessageRequest {} missing params", request.getId());
      return invalidParamsResponse(request, "Request params are missing");
    }

    logger.debug("Dispatching A2A sendMessage request {}", request.getId());
    // ServerCallContext is null: no auth/extension context in this transport-only demo. The
    // JSON-RPC handler maps agent failures onto a JSON-RPC error response internally.
    return handler.onMessageSend(request, null);
  }

  private static SendMessageResponse invalidParamsResponse(
      SendMessageRequest request, String reason) {
    JSONRPCError error = new JSONRPCError(ERROR_CODE_INVALID_PARAMS, reason, null);
    return new SendMessageResponse(request != null ? request.getId() : null, error);
  }
}
