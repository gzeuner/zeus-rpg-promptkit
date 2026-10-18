     Hnomain
     FPLANFILE_1UF A E           K DISK
     F                                     RENAME(PLANREC:PLANREC1)
     C                   CHAIN(N)  PLANREC1
      /FREE
       update PLANREC1 %fields(QTY);
       unlock PLANFILE_1;
       read MISSING;
      /END-FREE