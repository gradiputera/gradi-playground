<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;

/** Planned endpoints answer 501 until a later change implements them. They write nothing. */
class NotImplementedController
{
    public function __invoke(): JsonResponse
    {
        return new JsonResponse([
            'error' => 'not_implemented',
            'message' => 'This endpoint is planned and not implemented yet.',
        ], 501);
    }
}
