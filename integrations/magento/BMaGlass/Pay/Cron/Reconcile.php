<?php

namespace BMaGlass\Pay\Cron;

use BMaGlass\Pay\Model\Reconciler;

/** Every-5-minutes settlement reconciliation (see etc/crontab.xml). */
class Reconcile
{
    private $reconciler;

    public function __construct(Reconciler $reconciler)
    {
        $this->reconciler = $reconciler;
    }

    public function execute()
    {
        $this->reconciler->reconcilePending();
    }
}
